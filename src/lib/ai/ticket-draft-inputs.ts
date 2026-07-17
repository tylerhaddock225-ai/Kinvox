import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shared input builder for the ticket-reply draft, used by BOTH the manual
// "Draft with AI" action (draftTicketReply) and the auto-draft drainer. It runs
// the master gate and resolves everything draftAiReply needs from a ticket:
//   ticket ownership → gate (feature_flags.ai_support_enabled + ai_template_id)
//   → latest inbound customer message → PII identifiers → tag-stripped subject.
//
// The Supabase client is a parameter so the caller controls the trust context:
// the org-side action passes its RLS client (org-scoped by policy); the
// session-less drainer/cron passes the service-role admin client. No side effects.
//
// It deliberately does NOT check organizations.ai_drafting_mode — the manual
// path must work regardless of mode; the drainer checks the mode separately.

export type TicketDraftInputsError =
  | 'ticket_not_found'
  | 'ai_support_disabled'
  | 'no_customer_message'

export type TicketDraftInputs =
  | { ok: false; error: TicketDraftInputsError }
  | {
      ok: true
      // The specific inbound message this draft answers (the drainer stores it
      // as ai_ticket_drafts.source_message_id — the staleness key).
      inboundMessageId: string
      inboundBody:      string
      knownIdentifiers: string[]
      subject:          string
    }

export async function buildTicketDraftInputs(
  client: SupabaseClient,
  orgId: string,
  ticketId: string,
): Promise<TicketDraftInputs> {
  if (!ticketId) return { ok: false, error: 'ticket_not_found' }

  // Confirm the ticket belongs to this org (RLS also enforces it for the org
  // client; the check gives a friendlier error and scopes the admin client).
  const { data: ticket } = await client
    .from('tickets')
    .select('id, organization_id, subject, customer_id')
    .eq('id', ticketId)
    .single<{ id: string; organization_id: string; subject: string | null; customer_id: string | null }>()

  if (!ticket || ticket.organization_id !== orgId) {
    return { ok: false, error: 'ticket_not_found' }
  }

  // GATE: master flag on AND a template assigned (no template →
  // resolveAiPromptForOrg yields an empty prompt, nothing to draft from).
  const { data: org } = await client
    .from('organizations')
    .select('feature_flags, ai_template_id')
    .eq('id', orgId)
    .single<{ feature_flags: Record<string, unknown> | null; ai_template_id: string | null }>()

  const aiSupportEnabled = org?.feature_flags?.ai_support_enabled === true
  if (!aiSupportEnabled || !org?.ai_template_id) {
    return { ok: false, error: 'ai_support_disabled' }
  }

  // userContent = the latest INBOUND customer message (system-authored inbound
  // rows have sender_id = null). Nothing to reply to if there isn't one.
  const { data: inbound } = await client
    .from('ticket_messages')
    .select('id, body')
    .eq('ticket_id', ticketId)
    .is('sender_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; body: string }>()

  if (!inbound?.body?.trim()) {
    return { ok: false, error: 'no_customer_message' }
  }

  // knownIdentifiers for redactPii: the customer's contact fields + explicit
  // recipient emails on the ticket. Every non-null value is passed for redaction.
  const identifiers = new Set<string>()
  if (ticket.customer_id) {
    const { data: customer } = await client
      .from('customers')
      .select('first_name, last_name, email, phone')
      .eq('id', ticket.customer_id)
      .maybeSingle<{ first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>()
    for (const v of [customer?.first_name, customer?.last_name, customer?.email, customer?.phone]) {
      if (v) identifiers.add(v)
    }
  }
  const { data: recipients } = await client
    .from('ticket_recipients')
    .select('email')
    .eq('ticket_id', ticketId)
  for (const r of (recipients ?? []) as Array<{ email: string | null }>) {
    if (r.email) identifiers.add(r.email)
  }

  // Strip any [tk_…] tag from the subject before using it as (redacted) context.
  const subject = (ticket.subject ?? '').replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()

  return {
    ok:               true,
    inboundMessageId: inbound.id,
    inboundBody:      inbound.body,
    knownIdentifiers: Array.from(identifiers),
    subject,
  }
}
