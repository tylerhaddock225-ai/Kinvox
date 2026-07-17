import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildTicketDraftInputs } from '@/lib/ai/ticket-draft-inputs'
import { draftAiReply } from '@/lib/ai/draft-reply'
import { TICKET_REPLY_FRAME } from '@/lib/ai/frames'

// Auto-draft queue engine (Workstream AD Stage 1).
//   * enqueueDraftJob — the producer. AD-2 calls it on inbound customer messages;
//     AD-6 (refill sweep) calls it for the unanswered backlog.
//   * drainDraftJobs — the consumer. Directly invokable (the fast path — AD-2
//     kicks it via next/server after()) and by the daily Vercel-Cron backstop.
// Nothing enqueues yet, so shipping this is a no-op: the queue is always empty.
//
// All DB work uses the service-role admin client — the drain runs session-less.

const LOG = '[auto-draft]'
const MAX_ATTEMPTS = 3

type AiDraftJob = {
  id:                string
  organization_id:   string
  ticket_id:         string
  source_message_id: string | null
  status:            string
  reason:            string
  attempts:          number
  last_error:        string | null
}

export type DrainSummary = { claimed: number; drafted: number; skipped: number; failed: number }

/**
 * Enqueue a draft job for a ticket. Idempotent per ticket: the partial UNIQUE
 * index (ticket_id WHERE status in pending|processing) guarantees at most one
 * LIVE job, so a duplicate insert hits 23505 and is swallowed. Never throws —
 * the inbound webhook / refill sweep must never be sunk by a queue hiccup.
 */
export async function enqueueDraftJob(args: {
  orgId:           string
  ticketId:        string
  sourceMessageId: string | null
  reason:          'inbound_message' | 'refill_sweep'
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('ai_draft_jobs').insert({
    organization_id:   args.orgId,
    ticket_id:         args.ticketId,
    source_message_id: args.sourceMessageId,
    reason:            args.reason,
  })
  // 23505 = a live job already exists for this ticket (partial unique) → fine.
  if (error && error.code !== '23505') {
    console.error(`${LOG} enqueue failed ticket=${args.ticketId} reason=${args.reason}: ${error.message}`)
  }
}

function serializeErr(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}${(err as any).status ? ` (status ${(err as any).status})` : ''}`
  }
  try { return JSON.stringify(err) } catch { return String(err) }
}

async function finalizeJob(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  status: 'pending' | 'done' | 'failed' | 'skipped',
  lastError: string | null,
): Promise<void> {
  const { error } = await admin
    .from('ai_draft_jobs')
    .update({ status, last_error: lastError, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) {
    console.error(`${LOG} finalize job=${jobId} status=${status} failed: ${error.message}`)
  }
}

/**
 * Drain up to `limit` pending jobs. Each is claimed atomically (FOR UPDATE SKIP
 * LOCKED via claim_ai_draft_job), re-checked against the org's LIVE state (mode +
 * master gate), drafted against the LATEST inbound message, stored to
 * ai_ticket_drafts, and marked terminal. Concurrent drains are safe (SKIP LOCKED).
 * Returns a summary for logging.
 */
export async function drainDraftJobs(limit = 5): Promise<DrainSummary> {
  const admin = createAdminClient()
  const summary: DrainSummary = { claimed: 0, drafted: 0, skipped: 0, failed: 0 }

  for (let i = 0; i < limit; i++) {
    // 1) Claim the oldest pending job atomically.
    const { data: claimData, error: claimErr } = await admin.rpc('claim_ai_draft_job')
    if (claimErr) {
      console.error(`${LOG} claim failed: ${claimErr.message}`)
      break
    }
    const job = (Array.isArray(claimData) ? claimData[0] : claimData) as AiDraftJob | undefined
    if (!job || !job.id) break  // queue empty
    summary.claimed++

    try {
      // 2a) Mode must still be auto_draft (the org may have switched to manual
      //     after the job was enqueued).
      const { data: modeRow } = await admin
        .from('organizations')
        .select('ai_drafting_mode')
        .eq('id', job.organization_id)
        .maybeSingle<{ ai_drafting_mode: string }>()
      if (modeRow?.ai_drafting_mode !== 'auto_draft') {
        await finalizeJob(admin, job.id, 'skipped', 'mode_manual')
        summary.skipped++
        continue
      }

      // 2b) Master gate + latest inbound + PII identifiers (shared builder,
      //     admin client). Covers gate-off / no-inbound / ticket-gone → skip
      //     with the reason label ('ai_support_disabled' | 'no_customer_message'
      //     | 'ticket_not_found').
      const inputs = await buildTicketDraftInputs(admin, job.organization_id, job.ticket_id)
      if (!inputs.ok) {
        await finalizeJob(admin, job.id, 'skipped', inputs.error)
        summary.skipped++
        continue
      }

      // 3) Draft against the LATEST inbound (inputs.inboundMessageId); the job's
      //    source_message_id is informational — a newer inbound may have arrived.
      let result
      try {
        result = await draftAiReply({
          orgId:            job.organization_id,
          action:           'ticket_reply_auto',
          referenceId:      job.ticket_id,
          taskFrame:        TICKET_REPLY_FRAME,
          systemContext:    inputs.subject ? `Support ticket subject: ${inputs.subject}` : undefined,
          userContent:      inputs.inboundBody,
          knownIdentifiers: inputs.knownIdentifiers,
          createdBy:        undefined,  // system auto-draft
        })
      } catch (err) {
        // Transport / missing key / etc. Retry until MAX_ATTEMPTS, then fail.
        const detail = serializeErr(err)
        if (job.attempts < MAX_ATTEMPTS) {
          await finalizeJob(admin, job.id, 'pending', detail)  // re-queue
        } else {
          await finalizeJob(admin, job.id, 'failed', detail)
          summary.failed++
        }
        continue
      }

      if (!result.ok) {
        // The only ok:false variant is insufficient_credits → silent skip per
        // design. The refill sweep (AD-6) re-enqueues once the org tops up.
        await finalizeJob(admin, job.id, 'skipped', 'insufficient_credits')
        summary.skipped++
        continue
      }

      // 4) Store the draft (upsert — one live draft per ticket; regenerate replaces).
      const { error: upsertErr } = await admin
        .from('ai_ticket_drafts')
        .upsert({
          ticket_id:         job.ticket_id,
          organization_id:   job.organization_id,
          body:              result.text,
          source_message_id: inputs.inboundMessageId,
          model:             result.model,
          created_by:        null,  // system auto-draft
          updated_at:        new Date().toISOString(),
        }, { onConflict: 'ticket_id' })

      if (upsertErr) {
        // The credit was already spent; a storage miss must not silently vanish.
        await finalizeJob(admin, job.id, 'failed', `draft_store_failed: ${upsertErr.message}`)
        summary.failed++
        continue
      }

      await finalizeJob(admin, job.id, 'done', null)
      summary.drafted++
    } catch (err) {
      // Defensive: any unexpected throw in the per-job body must not wedge the loop.
      const detail = serializeErr(err)
      if (job.attempts < MAX_ATTEMPTS) {
        await finalizeJob(admin, job.id, 'pending', detail)
      } else {
        await finalizeJob(admin, job.id, 'failed', detail)
        summary.failed++
      }
    }
  }

  return summary
}
