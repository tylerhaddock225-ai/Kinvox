import 'server-only'
import { after } from 'next/server'
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

// ── Workstream AD Stage 2 — inbound auto-draft producer ──────────────────────
// Shared by BOTH inbound webhooks (postmark email + twilio SMS). Called after a
// customer inbound message is persisted. For auto-mode orgs it enqueues a draft
// job and kicks the drainer AFTER the response (next/server after()), so the
// webhook never pays the ~3-8s Claude latency. Purely additive + best-effort: it
// never throws and never changes the webhook's routing result. `supabase` is the
// caller's service-role admin client.
export async function maybeEnqueueAutoDraft(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  ticketId: string,
  sourceMessageId: string,
): Promise<void> {
  try {
    // Gate: auto mode on AND master flag on AND a template assigned. Any miss →
    // no-op (mirrors draftTicketReply's gate; the drainer re-checks at drain
    // time too, so a race here is harmless).
    const { data: org } = await supabase
      .from('organizations')
      .select('ai_drafting_mode, feature_flags, ai_template_id')
      .eq('id', orgId)
      .maybeSingle<{ ai_drafting_mode: string | null; feature_flags: Record<string, unknown> | null; ai_template_id: string | null }>()

    const autoDraft        = org?.ai_drafting_mode === 'auto_draft'
    const aiSupportEnabled = org?.feature_flags?.ai_support_enabled === true
    if (!autoDraft || !aiSupportEnabled || !org?.ai_template_id) return

    // Staleness: if a stored draft answers an OLDER inbound, drop it now. On
    // success the drain UPSERTs a fresh draft (onConflict ticket_id) — but if the
    // drain later SKIPS (e.g. zero balance at drain time), a stored draft
    // answering a superseded message is worse than none, so remove it up front.
    const { data: existingDraft } = await supabase
      .from('ai_ticket_drafts')
      .select('source_message_id')
      .eq('ticket_id', ticketId)
      .maybeSingle<{ source_message_id: string | null }>()
    if (existingDraft && existingDraft.source_message_id !== sourceMessageId) {
      await supabase.from('ai_ticket_drafts').delete().eq('ticket_id', ticketId)
    }

    // Enqueue (idempotent per ticket via the partial-unique live-job index;
    // never throws) then kick the drainer post-response.
    await enqueueDraftJob({ orgId, ticketId, sourceMessageId, reason: 'inbound_message' })
    after(async () => {
      try {
        await drainDraftJobs(3)
      } catch (err) {
        console.error(`${LOG} [auto-draft-kick] drain failed ticket=${ticketId}:`, err)
      }
    })
  } catch (err) {
    // Defensive: the auto-draft hook must NEVER fail the webhook.
    console.error(`${LOG} [auto-draft-kick] enqueue hook failed ticket=${ticketId}:`, err)
  }
}

// ── Workstream AD Stage 6 — refill sweep ─────────────────────────────────────
// When an org's credit balance INCREASES (Stripe top-up or an HQ manual grant),
// any inbound customer message whose auto-draft was skipped at zero balance is
// now draftable. sweepUnansweredTickets finds that backlog and re-enqueues jobs;
// the drainer (kicked right after by the call site) does the drafting until the
// balance exhausts again — its insufficient_credits skip handles running dry.
//
// A DB trigger can't call Claude, so this runs in app code at BOTH credit-increase
// call sites (they both already run through app code: the Stripe webhook route and
// the HQ addCredits action). No migration. Revisit only if a third live
// balance-increase path ever appears.
const SWEEP_ENQUEUE_CAP = 25   // safety: at most this many jobs per sweep event
const SWEEP_CANDIDATE_SCAN = 100  // bound the ticket pre-scan before the latest-message check

/**
 * Enqueue refill-sweep draft jobs for an org's unanswered ticket backlog, oldest
 * first. Gated identically to the inbound producer (auto_draft mode + master gate
 * + template). "Unanswered" = an open/pending, non-deleted, non-platform-support
 * ticket whose LATEST message is inbound (sender_id IS NULL), with no stored draft
 * and no live (pending/processing) job. All queries are batched (no per-row loops).
 * Best-effort per ticket via enqueueDraftJob (never throws). Returns the count
 * enqueued.
 */
export async function sweepUnansweredTickets(orgId: string): Promise<{ swept: number }> {
  const admin = createAdminClient()

  // 1) Gate — mirrors maybeEnqueueAutoDraft in the inbound webhook. Any miss → no-op.
  const { data: org } = await admin
    .from('organizations')
    .select('ai_drafting_mode, feature_flags, ai_template_id')
    .eq('id', orgId)
    .maybeSingle<{ ai_drafting_mode: string | null; feature_flags: Record<string, unknown> | null; ai_template_id: string | null }>()
  const autoDraft        = org?.ai_drafting_mode === 'auto_draft'
  const aiSupportEnabled = org?.feature_flags?.ai_support_enabled === true
  if (!autoDraft || !aiSupportEnabled || !org?.ai_template_id) return { swept: 0 }

  // 2) Candidate open/pending tickets, oldest first (non-deleted, non-platform).
  //    Bounded scan — the cap below limits enqueues anyway.
  const { data: ticketRows } = await admin
    .from('tickets')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_platform_support', false)
    .is('deleted_at', null)
    .in('status', ['open', 'pending'])
    .order('created_at', { ascending: true })
    .limit(SWEEP_CANDIDATE_SCAN)
  const candidateIds = ((ticketRows ?? []) as { id: string }[]).map(t => t.id)
  if (candidateIds.length === 0) return { swept: 0 }

  // Drop tickets that already have a stored draft or a live job (two batched
  // anti-join lookups keyed to the candidate ids).
  const [draftsRes, jobsRes] = await Promise.all([
    admin.from('ai_ticket_drafts').select('ticket_id').in('ticket_id', candidateIds),
    admin.from('ai_draft_jobs').select('ticket_id').in('ticket_id', candidateIds).in('status', ['pending', 'processing']),
  ])
  const skip = new Set<string>()
  for (const d of (draftsRes.data ?? []) as { ticket_id: string }[]) skip.add(d.ticket_id)
  for (const j of (jobsRes.data  ?? []) as { ticket_id: string }[]) skip.add(j.ticket_id)
  const eligibleIds = candidateIds.filter(id => !skip.has(id))
  if (eligibleIds.length === 0) return { swept: 0 }

  // 3) Latest message per eligible ticket — ONE batched fetch, newest first;
  //    keep the first row seen per ticket (= its latest). Uses the existing
  //    (ticket_id, created_at) index. Unanswered = that latest message is inbound.
  const { data: msgRows } = await admin
    .from('ticket_messages')
    .select('ticket_id, id, sender_id, created_at')
    .in('ticket_id', eligibleIds)
    .order('created_at', { ascending: false })
  const latestByTicket = new Map<string, { id: string; senderId: string | null }>()
  for (const m of (msgRows ?? []) as { ticket_id: string; id: string; sender_id: string | null }[]) {
    if (!latestByTicket.has(m.ticket_id)) latestByTicket.set(m.ticket_id, { id: m.id, senderId: m.sender_id })
  }

  // 4) Enqueue oldest-first (eligibleIds preserves the ticket scan's created_at asc
  //    order), capped. Skip tickets with no messages or an agent-authored latest.
  let swept = 0
  for (const ticketId of eligibleIds) {
    if (swept >= SWEEP_ENQUEUE_CAP) break
    const latest = latestByTicket.get(ticketId)
    if (!latest || latest.senderId !== null) continue
    await enqueueDraftJob({ orgId, ticketId, sourceMessageId: latest.id, reason: 'refill_sweep' })
    swept++
  }

  if (swept > 0) console.log(`${LOG} refill sweep enqueued ${swept} job(s) org=${orgId}`)
  return { swept }
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
