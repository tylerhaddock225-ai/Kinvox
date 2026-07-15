// The single AI-drafting primitive. Stage 2 (Ticket Assist) and Stage 3
// (Review Agent) both call this — it is the only place that ties together the
// org's prompt template, the PII guard, the Claude call, usage logging, and the
// credit deduction. No UI and no ticket/review wiring live here (that is Stage
// 2/3); this is the shared spine they build on.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveAiPromptForOrg } from '@/lib/ai-runtime'
import { generateClaudeReply } from '@/lib/ai/claude'
import { redactPii } from '@/lib/ai/redact'
import { deductCredit, getOrgCredits } from '@/lib/credits'

export type DraftAiReplyArgs = {
  // The tenant org. The CALLER resolves this (via resolveEffectiveOrgId, so it
  // is impersonation-correct) and passes it in — this primitive never reads the
  // raw session profile org itself.
  orgId:             string
  // Short label for what is being drafted (e.g. 'ticket_reply', 'review_reply').
  // Flows into ai_usage_log.action and credit_ledger.type.
  action:            string
  // The domain object the draft is for (ticket/review/lead) — Manifest #7.
  referenceId:       string
  // Optional caller-supplied free-text context appended to the org template
  // prompt. PII-redacted before it reaches Claude.
  systemContext?:    string
  // The message to draft a reply to. PII-redacted before it reaches Claude.
  userContent:       string
  // Identifiers the caller holds for the subject (name, email, phone, handle).
  // Required for the PII guard to do its job — see redactPii.
  knownIdentifiers?: string[]
  // The human on whose behalf the draft is made, for the audit row (nullable).
  createdBy?:        string | null
}

export type DraftAiReplyResult =
  | { ok: true;  text: string; balance: number }
  | { ok: false; error: 'insufficient_credits' }

/**
 * Draft an AI reply for an org: resolve its prompt template, strip PII, call
 * Claude, record usage, then spend one credit.
 *
 * Usage is logged BEFORE the deduction on purpose — if the deduction fails
 * (insufficient credits) the audit row still exists, so AI spend is never
 * unaccounted for.
 */
export async function draftAiReply(args: DraftAiReplyArgs): Promise<DraftAiReplyResult> {
  const {
    orgId,
    action,
    referenceId,
    systemContext,
    userContent,
    knownIdentifiers = [],
    createdBy = null,
  } = args

  // 1) Resolve the org's assigned template → final system prompt (template IP,
  //    not PII — left un-redacted).
  const resolved = await resolveAiPromptForOrg(orgId)

  // 2) Redact PII from everything the caller provides (Manifest #8): the
  //    free-text systemContext and the userContent both pass through the guard.
  const safeSystemContext = systemContext ? redactPii(systemContext, knownIdentifiers) : ''
  const safeUserContent   = redactPii(userContent, knownIdentifiers)
  const systemPrompt      = [resolved.prompt, safeSystemContext].filter(Boolean).join('\n\n')

  // 3) Balance pre-check (optimization only): skip the Claude call entirely when
  //    the org clearly can't pay, so a zero-balance org never incurs a real API
  //    charge. deduct_credit's atomic `balance >= amount` guard below remains the
  //    authoritative source of truth against concurrent drains.
  const credits = await getOrgCredits(orgId)
  if (!credits || credits.balance < 1) {
    return { ok: false, error: 'insufficient_credits' }
  }

  // 4) Call Claude.
  const reply = await generateClaudeReply(systemPrompt, safeUserContent)

  // 5) Log usage BEFORE deducting. Service-role write (bypasses the fail-closed
  //    RLS on ai_usage_log). Best-effort: an audit-log hiccup must not sink the
  //    draft the tenant already paid Claude for.
  const admin = createAdminClient()
  const { error: logError } = await admin.from('ai_usage_log').insert({
    organization_id: orgId,
    action,
    model:           reply.model,
    tokens_in:       reply.tokensIn,
    tokens_out:      reply.tokensOut,
    reference_id:    referenceId,
    created_by:      createdBy,
  })
  if (logError) {
    console.error(`[ai-draft] ai_usage_log insert failed org=${orgId} action=${action}: ${logError.message}`)
  }

  // 6) Spend one credit, tagging the ledger row with the action.
  const deduct = await deductCredit(orgId, 1, referenceId, action)
  if (!deduct.ok) {
    return { ok: false, error: 'insufficient_credits' }
  }

  return { ok: true, text: reply.text, balance: deduct.balance }
}
