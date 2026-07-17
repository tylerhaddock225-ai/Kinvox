'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId, revalidateOrgPath } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { renderConversationReply, type PriorMessage } from '@/lib/email/templates/reply'
import { draftAiReply } from '@/lib/ai/draft-reply'
import { TICKET_REPLY_FRAME } from '@/lib/ai/frames'
import { buildTicketDraftInputs } from '@/lib/ai/ticket-draft-inputs'

type State = { status: 'success' } | { status: 'error'; error: string } | null

// Distinct result shape for the AI-draft action: it returns text on success and
// a typed error code on failure (the client maps codes to user-facing copy).
export type DraftReplyResult =
  | { ok: true;  text: string }
  | {
      ok: false
      error:
        | 'not_authenticated'
        | 'no_organization'
        | 'ticket_not_found'
        | 'ai_support_disabled'
        | 'no_customer_message'
        | 'insufficient_credits'
        | 'draft_failed'
    }

export async function createTicket(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const subject     = formData.get('subject')     as string
  const description = formData.get('description') as string | null
  const priority    = formData.get('priority')    as string
  const status      = formData.get('status')      as string
  const channel     = formData.get('channel')     as string | null
  const assigned_to = formData.get('assigned_to') as string | null
  const customer_id = formData.get('customer_id') as string | null
  const lead_id_raw = formData.get('lead_id')     as string | null

  if (!subject?.trim()) return { status: 'error', error: 'Subject is required' }

  // The modal posts customer_id (new). Older callers / inbound flows may still
  // post lead_id; in that case, look up the matching customer.
  const link = await resolveCustomerLink(supabase, orgId, customer_id, lead_id_raw)

  const { error } = await supabase.from('tickets').insert({
    organization_id: orgId,
    created_by:  user.id,
    subject:     subject.trim(),
    description: description || null,
    priority:    (priority || 'medium') as 'low' | 'medium' | 'high',
    status:      (status   || 'open')   as 'open' | 'pending' | 'closed',
    channel:     (channel  || null)     as 'email' | 'chat' | 'phone' | 'portal' | 'manual' | null,
    assigned_to: assigned_to || null,
    customer_id: link.customerId,
    lead_id:     link.leadId,
  })

  if (error) return { status: 'error', error: error.message }

  await revalidateOrgPath(supabase, orgId, '/tickets')
  return { status: 'success' }
}

const STATUS_VALUES   = ['open', 'pending', 'closed'] as const
const PRIORITY_VALUES = ['low', 'medium', 'high']     as const
const HQ_CATEGORIES   = ['bug', 'billing', 'feature_request', 'question'] as const
// Must track tickets_affected_tab_check in 20260419222000_hq_form_toggles.sql
// and AFFECTED_TABS in HQSupportModal.tsx.
const AFFECTED_TABS   = ['dashboard', 'leads', 'customers', 'appointments', 'tickets', 'settings'] as const
type TicketStatus   = typeof STATUS_VALUES[number]
type TicketPriority = typeof PRIORITY_VALUES[number]
type HQCategory     = typeof HQ_CATEGORIES[number]
type AffectedTab    = typeof AFFECTED_TABS[number]

// HQ support tickets live in the merchant's own org (so insert RLS passes
// without bypass) and are flagged is_platform_support=true. Merchant-facing
// ticket queries filter the flag out; Admin HQ's /hq/tickets surfaces
// them by filtering is_platform_support=true.
export async function createHQSupportTicket(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const subject         = formData.get('subject')        as string
  const description     = formData.get('description')    as string | null
  const category        = formData.get('hq_category')    as string
  const screenshot_url  = formData.get('screenshot_url') as string | null
  const affected_tab    = formData.get('affected_tab')   as string | null
  const record_id_raw   = formData.get('record_id')      as string | null

  if (!subject?.trim()) return { status: 'error', error: 'Subject is required' }
  if (!HQ_CATEGORIES.includes(category as HQCategory)) {
    return { status: 'error', error: 'Invalid category' }
  }

  // affected_tab is optional; validate only when the merchant actually sent one.
  // Silently treats the empty-string "\u2014 None \u2014" selection as null.
  const tabTrimmed = affected_tab?.trim() || ''
  if (tabTrimmed && !AFFECTED_TABS.includes(tabTrimmed as AffectedTab)) {
    return { status: 'error', error: 'Invalid affected tab' }
  }
  const normalizedTab: AffectedTab | null = tabTrimmed ? (tabTrimmed as AffectedTab) : null

  // record_id is free-form; cap length so a pathological paste can't bloat rows.
  const recordId = record_id_raw?.trim().slice(0, 64) || null

  const { error } = await supabase.from('tickets').insert({
    organization_id:     orgId,
    created_by:          user.id,
    subject:             subject.trim(),
    description:         description?.trim() || null,
    priority:            'medium',
    status:              'open',
    channel:             'portal',
    is_platform_support: true,
    hq_category:         category as HQCategory,
    screenshot_url:      screenshot_url?.trim() || null,
    affected_tab:        normalizedTab,
    record_id:           recordId,
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/support')
  revalidatePath('/[orgSlug]/hq-support', 'page')
  revalidatePath('/hq/tickets')
  return { status: 'success' }
}

export async function updateTicketStatus(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const ticket_id = formData.get('ticket_id') as string
  const status    = formData.get('status')    as string
  if (!ticket_id) return
  if (!STATUS_VALUES.includes(status as TicketStatus)) return

  // Pull the prior state so we can detect open→closed transitions for the
  // closure-notification email below. organization_id is needed downstream
  // to resolve the support inbound tag for the closure email's Reply-To.
  const { data: prior } = await supabase
    .from('tickets')
    .select('status, display_id, subject, lead_id, customer_id, organization_id')
    .eq('id', ticket_id)
    .single()

  // RLS already prevents cross-org updates; the trigger refreshes updated_at.
  const { error: updErr } = await supabase
    .from('tickets')
    .update({ status: status as TicketStatus })
    .eq('id', ticket_id)

  if (updErr) {
    console.error(`[ticket-status] update failed ticket=${ticket_id}: ${updErr.message}`)
    return
  }

  if (status === 'closed' && prior && prior.status !== 'closed') {
    const { data: closerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle<{ full_name: string | null }>()

    await dispatchClosureEmail({
      supabase,
      orgId:            prior.organization_id,
      closerName:       closerProfile?.full_name ?? null,
      ticketId:         ticket_id,
      ticketLeadId:     prior.lead_id,
      ticketCustomerId: prior.customer_id,
      ticketSubject:    prior.subject,
      ticketDisplayId:  prior.display_id,
    })
  }

  if (prior?.organization_id) {
    await revalidateOrgPath(supabase, prior.organization_id, '/tickets')
    await revalidateOrgPath(supabase, prior.organization_id, `/tickets/${ticket_id}`)
  }
  // Mirror the revalidations for the HQ views so inline edits from
  // /hq/tickets refresh the grid counts + detail immediately.
  revalidatePath('/hq/tickets')
  revalidatePath(`/hq/tickets/${ticket_id}`)
  revalidatePath('/support')
  revalidatePath('/[orgSlug]/hq-support', 'page')
  revalidatePath('/[orgSlug]/hq-support/[id]', 'page')
}

export async function updateTicketPriority(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const ticket_id = formData.get('ticket_id') as string
  const priority  = formData.get('priority')  as string
  if (!ticket_id) return
  if (!PRIORITY_VALUES.includes(priority as TicketPriority)) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  await supabase
    .from('tickets')
    .update({ priority: priority as TicketPriority })
    .eq('id', ticket_id)

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, '/tickets')
    await revalidateOrgPath(supabase, orgId, `/tickets/${ticket_id}`)
  }
  revalidatePath('/hq/tickets')
  revalidatePath(`/hq/tickets/${ticket_id}`)
  revalidatePath('/[orgSlug]/hq-support', 'page')
  revalidatePath('/[orgSlug]/hq-support/[id]', 'page')
}

export async function updateTicketSubject(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const ticket_id = formData.get('ticket_id') as string
  const subject   = formData.get('subject')   as string

  if (!ticket_id) return { status: 'error', error: 'Ticket is required' }
  if (!subject?.trim()) return { status: 'error', error: 'Subject cannot be empty' }

  const { error } = await supabase
    .from('tickets')
    .update({ subject: subject.trim() })
    .eq('id', ticket_id)

  if (error) return { status: 'error', error: error.message }

  const subjectOrgId = await resolveEffectiveOrgId(supabase, user.id)
  if (subjectOrgId) {
    await revalidateOrgPath(supabase, subjectOrgId, `/tickets/${ticket_id}`)
  }
  revalidatePath('/[orgSlug]/hq-support/[id]', 'page')
  return { status: 'success' }
}

export async function sendTicketMessage(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single<{ full_name: string | null }>()

  const ticket_id = formData.get('ticket_id') as string
  const body      = formData.get('body')      as string
  const type      = formData.get('type')      as string

  if (!ticket_id) return { status: 'error', error: 'Ticket is required' }
  if (!body?.trim()) return { status: 'error', error: 'Message cannot be empty' }
  if (type !== 'public' && type !== 'internal') {
    return { status: 'error', error: 'Invalid message type' }
  }

  // Confirm the ticket belongs to the effective org (real or impersonated)
  // before writing. RLS would block a cross-org insert anyway, but failing
  // fast gives a friendlier error than a constraint violation.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, organization_id, display_id, subject, lead_id, customer_id')
    .eq('id', ticket_id)
    .single()

  if (!ticket || ticket.organization_id !== orgId) {
    return { status: 'error', error: 'Ticket not found' }
  }

  const trimmed = body.trim()

  // Resolve the prior public message BEFORE inserting this one so the
  // quoted block can never accidentally include the in-flight message.
  // Falls through to ticket.description on first reply (handled in
  // dispatchOutboundEmail).
  let priorPublic: { body: string; created_at: string; sender_id: string | null } | null = null
  if (type === 'public') {
    const { data } = await supabase
      .from('ticket_messages')
      .select('body, created_at, sender_id')
      .eq('ticket_id', ticket_id)
      .eq('type', 'public')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ body: string; created_at: string; sender_id: string | null }>()
    priorPublic = data ?? null
  }

  const { error } = await supabase.from('ticket_messages').insert({
    ticket_id,
    org_id:    orgId,
    sender_id: user.id,
    body:      trimmed,
    type,
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/hq-support/[id]', 'page')

  if (type === 'public') {
    await dispatchOutboundEmail({
      supabase,
      orgId,
      senderName:       senderProfile?.full_name ?? null,
      ticketId:         ticket.id,
      ticketLeadId:     ticket.lead_id,
      ticketCustomerId: ticket.customer_id,
      ticketSubject:    ticket.subject,
      ticketDisplayId:  ticket.display_id,
      body:             trimmed,
      priorPublic,
    })
  }

  await revalidateOrgPath(supabase, orgId, `/tickets/${ticket_id}`)
  return { status: 'success' }
}

// Human-triggered "Draft with AI" (Ticket Assist, Stage 2a). This drafts a reply
// and returns the text — it does NOT insert a ticket_messages row or send email.
// The agent reviews/edits the returned text and sends it through the normal
// sendTicketMessage flow. Spends exactly the 1 credit draftAiReply deducts on
// success; no spend on any gated/early-return path (Claude is not called).
export async function draftTicketReply(ticketId: string): Promise<DraftReplyResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  // Same impersonation-correct org resolution sendTicketMessage uses.
  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { ok: false, error: 'no_organization' }

  // Load ticket → master gate → latest inbound customer message → PII
  // identifiers, via the shared builder (also used by the auto-draft drainer).
  // Here it runs on the RLS client (org-scoped by policy); the drainer passes
  // the admin client. Error codes are unchanged vs. the previous inline logic.
  const inputs = await buildTicketDraftInputs(supabase, orgId, ticketId)
  if (!inputs.ok) return { ok: false, error: inputs.error }

  try {
    const result = await draftAiReply({
      orgId,
      action:           'ticket_reply',
      referenceId:      ticketId,
      taskFrame:        TICKET_REPLY_FRAME,
      systemContext:    inputs.subject ? `Support ticket subject: ${inputs.subject}` : undefined,
      userContent:      inputs.inboundBody,
      knownIdentifiers: inputs.knownIdentifiers,
      createdBy:        user.id,
    })
    if (!result.ok) {
      return { ok: false, error: 'insufficient_credits' }
    }
    return { ok: true, text: result.text }
  } catch (err) {
    // Missing ANTHROPIC_API_KEY, transport error, etc. — fail gracefully so the
    // composer shows a friendly message instead of a crashed action. Serialize
    // robustly: a non-Error throw (PostgrestError-shaped object, SDK error
    // variant) stringifies to "[object Object]" and hides the cause.
    let detail = err instanceof Error
      ? `${err.name}: ${err.message}${(err as any).status ? ` (status ${(err as any).status})` : ''}`
      : (() => { try { return JSON.stringify(err) } catch { return String(err) } })()
    if (err instanceof Error && err.cause) {
      try { detail += ` cause=${JSON.stringify(err.cause)}` } catch { /* non-serializable cause */ }
    }
    console.error(`[ticket-draft] draftAiReply failed ticket=${ticketId} org=${orgId}: ${detail}`)
    return { ok: false, error: 'draft_failed' }
  }
}

type DispatchArgs = {
  supabase:         Awaited<ReturnType<typeof createClient>>
  orgId:            string
  senderName:       string | null
  ticketId:         string
  ticketLeadId:     string | null
  ticketCustomerId: string | null
  ticketSubject:    string
  ticketDisplayId:  string | null
  body:             string
  priorPublic:      { body: string; created_at: string; sender_id: string | null } | null
}

async function dispatchOutboundEmail(args: DispatchArgs) {
  const { data: org } = await args.supabase
    .from('organizations')
    .select('id, name, inbound_email_tag, verified_support_email, verified_support_email_confirmed_at')
    .eq('id', args.orgId)
    .single()

  if (!org) {
    console.error(`[ticket-email] org ${args.orgId} not found — skipping outbound email`)
    return
  }

  // Workstream E — recipient resolution via ticket_recipients with legacy
  // (customers.email / ticket_messages.inbound_email_from) fallback.
  const { to, cc, firstName: recipientFirstName } = await resolveTicketRecipients(
    args.supabase,
    args.ticketId,
    args.ticketCustomerId,
  )

  if (to.length === 0) {
    console.error(`[ticket-email] no recipient resolvable for ticket ${args.ticketId} — skipping outbound email`)
    return
  }

  const displayId = args.ticketDisplayId ?? args.ticketId

  // Strip any pre-existing [tk_…] tag so we don't double-tag on follow-ups.
  const baseSubject = args.ticketSubject.replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()
  const subject     = `[${displayId}] ${baseSubject || '(no subject)'}`
  const threadingId = `<${displayId}@kinvox.com>`

  // Plus-addressed Reply-To routes the recipient's reply through Postmark's
  // inbound mailbox into the support webhook. Without this, replies vanish
  // into the org's verified mailbox with no conversation-panel ingest.
  const replyTo = constructInboundEmailAddress(org.inbound_email_tag ?? null)
  if (!replyTo) {
    console.warn(`[outbound] inbound tag missing for org=${args.orgId} channel=support — reply-to omitted, recipient replies will land in org's verified mailbox and bypass conversation panel`)
  }

  // Resolve the quoted block. Prior public ticket_messages row → use its
  // sender's display name (profiles.full_name for org users; recipient
  // first name for inbound rows whose sender_id is null). Fall back to
  // ticket.description on first reply; skip the quoted block entirely if
  // that's also empty.
  let prior: PriorMessage | null = null
  if (args.priorPublic) {
    let priorSenderName = ''
    if (args.priorPublic.sender_id) {
      const { data: priorProfile } = await args.supabase
        .from('profiles')
        .select('full_name')
        .eq('id', args.priorPublic.sender_id)
        .maybeSingle<{ full_name: string | null }>()
      priorSenderName = priorProfile?.full_name?.trim() || ''
    }
    if (!priorSenderName) {
      priorSenderName = recipientFirstName?.trim() || 'them'
    }
    prior = {
      senderName: priorSenderName,
      sentAt:     new Date(args.priorPublic.created_at),
      body:       args.priorPublic.body,
    }
  } else {
    const { data: ticketBody } = await args.supabase
      .from('tickets')
      .select('description, created_at')
      .eq('id', args.ticketId)
      .maybeSingle<{ description: string | null; created_at: string }>()
    if (ticketBody?.description?.trim()) {
      prior = {
        senderName: recipientFirstName?.trim() || 'them',
        sentAt:     new Date(ticketBody.created_at),
        body:       ticketBody.description,
      }
    }
  }

  const replierFirstName = args.senderName?.trim().split(/\s+/)[0] ?? null
  const orgName          = org.name

  const { htmlBody, textBody } = renderConversationReply({
    leadFirstName:    recipientFirstName,
    replierFirstName,
    orgName,
    body:             args.body,
    prior,
  })

  const result = await sendOrgTransactionalEmail({
    org: {
      id:                                  org.id,
      name:                                org.name,
      verified_support_email:              org.verified_support_email,
      verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
    },
    to,
    cc:                cc.length > 0 ? cc : undefined,
    subject,
    htmlBody,
    textBody,
    replyTo:           replyTo ?? undefined,
    tag:               'ticket-reply',
    fromAddressSource: 'support',
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })

  if (!result.ok) {
    console.error(`[ticket-email] FAILED ticket=${displayId} to=${to.join(',')}: ${result.error}`)
  } else {
    console.log(`[ticket-email] dispatched ticket=${displayId} to=${to.join(',')} cc=${cc.length} postmark_id=${result.messageId}`)
  }
}

type ClosureArgs = {
  supabase:         Awaited<ReturnType<typeof createClient>>
  orgId:            string
  closerName:       string | null
  ticketId:         string
  ticketLeadId:     string | null
  ticketCustomerId: string | null
  ticketSubject:    string
  ticketDisplayId:  string | null
}

async function dispatchClosureEmail(args: ClosureArgs) {
  // Workstream E — bug fix: closure now honors org.verified_support_email
  // when set. The prior shape omitted the columns from this SELECT and
  // hardcoded the Kinvox shared mailbox even for merchants with a verified
  // sender on file.
  const { data: org } = await args.supabase
    .from('organizations')
    .select('id, name, inbound_email_tag, verified_support_email, verified_support_email_confirmed_at')
    .eq('id', args.orgId)
    .single()

  if (!org) {
    console.error(`[ticket-email] org ${args.orgId} not found — skipping closure notification`)
    return
  }

  const { to, cc, firstName: recipientFirstName } = await resolveTicketRecipients(
    args.supabase,
    args.ticketId,
    args.ticketCustomerId,
  )

  if (to.length === 0) {
    console.warn(`[ticket-email] no recipient resolvable for ticket ${args.ticketId} — skipping closure notification`)
    return
  }

  const displayId   = args.ticketDisplayId ?? args.ticketId
  const baseSubject = args.ticketSubject.replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()
  const subject     = `[${displayId}] ${baseSubject || '(no subject)'}`
  const threadingId = `<${displayId}@kinvox.com>`

  const replyTo = constructInboundEmailAddress(org.inbound_email_tag ?? null)
  if (!replyTo) {
    console.warn(`[outbound] inbound tag missing for org=${args.orgId} channel=support — reply-to omitted, recipient replies will land in org's verified mailbox and bypass conversation panel`)
  }

  // Closure body: canned text describing the status change. Threaded
  // through renderConversationReply so the closure notification reads
  // with the same greeting + sign-off treatment as a public reply.
  // Closure does NOT quote prior history (the resolution moment is the
  // notification — quoting one prior message would feel arbitrary).
  const cannedBody = `Your ticket (${displayId}) has been marked as resolved. If you have further questions, simply reply to this email to reopen it.`
  const replierFirstName = args.closerName?.trim().split(/\s+/)[0] ?? null
  const orgName = org.name
  const { htmlBody, textBody } = renderConversationReply({
    leadFirstName:    recipientFirstName,
    replierFirstName,
    orgName,
    body:             cannedBody,
    prior:            null,
  })

  const result = await sendOrgTransactionalEmail({
    org: {
      id:                                  org.id,
      name:                                org.name,
      verified_support_email:              org.verified_support_email,
      verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
    },
    to,
    cc:                cc.length > 0 ? cc : undefined,
    subject,
    htmlBody,
    textBody,
    replyTo:           replyTo ?? undefined,
    tag:               'ticket-closure',
    fromAddressSource: 'support',
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })

  if (!result.ok) {
    console.error(`[ticket-email] closure notice FAILED ticket=${displayId} to=${to.join(',')}: ${result.error}`)
  } else {
    console.log(`[ticket-email] closure notice dispatched ticket=${displayId} to=${to.join(',')} cc=${cc.length} postmark_id=${result.messageId}`)
  }
}

// Workstream E — outbound recipient resolution.
//
// Authoritative source is ticket_recipients (kind='to' / 'cc') seeded by the
// inbound webhook on ticket creation (Path C) and editable via the recipient
// picker UI. Each row is either email-populated (use as-is) or user_id-
// populated (resolve via auth.admin.getUserById — needs the service-role
// admin client because the request-scoped supabase client doesn't expose
// .auth.admin).
//
// When no recipient rows exist (legacy tickets that pre-date the table) we
// fall back to the original Tier-1 customers.email / Tier-2
// ticket_messages.inbound_email_from chain. firstName is only populated on
// the Tier-1 customer path — explicit recipient rows have no first-name
// field, so the conversation-reply greeting collapses to "Hi there".
type ResolvedRecipients = {
  to:        string[]
  cc:        string[]
  firstName: string | null
}

async function resolveTicketRecipients(
  supabase:         Awaited<ReturnType<typeof createClient>>,
  ticketId:         string,
  ticketCustomerId: string | null,
): Promise<ResolvedRecipients> {
  const { data: rows } = await supabase
    .from('ticket_recipients')
    .select('kind, user_id, email')
    .eq('ticket_id', ticketId)

  if (rows && rows.length > 0) {
    const to: string[] = []
    const cc: string[] = []
    let adminClient: ReturnType<typeof createAdminClient> | null = null
    for (const row of rows) {
      let resolvedEmail: string | null = row.email
      if (!resolvedEmail && row.user_id) {
        if (!adminClient) adminClient = createAdminClient()
        const { data, error } = await adminClient.auth.admin.getUserById(row.user_id)
        if (error || !data?.user?.email) {
          console.warn(`[ticket-email] could not resolve user_id=${row.user_id} for ticket=${ticketId}`)
          continue
        }
        resolvedEmail = data.user.email
      }
      if (!resolvedEmail) continue
      if (row.kind === 'cc') cc.push(resolvedEmail)
      else                   to.push(resolvedEmail)
    }
    return { to, cc, firstName: null }
  }

  // Legacy fallback for tickets created before ticket_recipients existed.
  let toEmail:   string | null = null
  let firstName: string | null = null
  if (ticketCustomerId) {
    const { data: customer } = await supabase
      .from('customers')
      .select('email, first_name')
      .eq('id', ticketCustomerId)
      .is('deleted_at', null)
      .maybeSingle<{ email: string | null; first_name: string | null }>()
    if (customer?.email) {
      toEmail   = customer.email
      firstName = customer.first_name ?? null
    }
  }
  if (!toEmail) {
    const { data: lastInbound } = await supabase
      .from('ticket_messages')
      .select('inbound_email_from')
      .eq('ticket_id', ticketId)
      .not('inbound_email_from', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ inbound_email_from: string | null }>()
    toEmail = lastInbound?.inbound_email_from ?? null
  }
  return { to: toEmail ? [toEmail] : [], cc: [], firstName }
}

// Resolve {customer_id, lead_id} pair from whatever the caller provided.
// Modal forms post customer_id; inbound webhooks / older callers may post
// lead_id. Either way we end up with both fields populated when possible
// so downstream queries by either column find the row.
//
// Always scoped by organization_id — a stale customer_id pointing at another
// org silently downgrades to (null, null) rather than leaking across tenants.
async function resolveCustomerLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId:    string,
  customerId: string | null,
  leadId:     string | null,
): Promise<{ customerId: string | null; leadId: string | null }> {
  if (customerId) {
    const { data } = await supabase
      .from('customers')
      .select('id, lead_id')
      .eq('id', customerId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!data) return { customerId: null, leadId: null }
    return { customerId: data.id, leadId: data.lead_id }
  }

  if (leadId) {
    const { data } = await supabase
      .from('customers')
      .select('id, lead_id')
      .eq('lead_id', leadId)
      .eq('organization_id', orgId)
      .maybeSingle()
    return { customerId: data?.id ?? null, leadId }
  }

  return { customerId: null, leadId: null }
}

