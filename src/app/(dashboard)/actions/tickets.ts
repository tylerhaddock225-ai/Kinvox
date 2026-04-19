'use server'

import { ServerClient } from 'postmark'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type State = { status: 'success' } | { status: 'error'; error: string } | null

export async function createTicket(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization' }

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
  const link = await resolveCustomerLink(supabase, profile.organization_id, customer_id, lead_id_raw)

  const { error } = await supabase.from('tickets').insert({
    organization_id: profile.organization_id,
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

  revalidatePath('/tickets')
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
// ticket queries filter the flag out; Admin HQ's /admin-hq/tickets surfaces
// them via ?scope=platform.
export async function createHQSupportTicket(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization' }

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
    organization_id:     profile.organization_id,
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
  revalidatePath('/admin-hq/tickets')
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
  // closure-notification email below.
  const { data: prior } = await supabase
    .from('tickets')
    .select('status, display_id, subject, lead_id')
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
    await dispatchClosureEmail({
      supabase,
      ticketId:        ticket_id,
      ticketLeadId:    prior.lead_id,
      ticketSubject:   prior.subject,
      ticketDisplayId: prior.display_id,
    })
  }

  revalidatePath('/tickets')
  revalidatePath(`/tickets/${ticket_id}`)
}

export async function updateTicketPriority(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const ticket_id = formData.get('ticket_id') as string
  const priority  = formData.get('priority')  as string
  if (!ticket_id) return
  if (!PRIORITY_VALUES.includes(priority as TicketPriority)) return

  await supabase
    .from('tickets')
    .update({ priority: priority as TicketPriority })
    .eq('id', ticket_id)

  revalidatePath('/tickets')
  revalidatePath(`/tickets/${ticket_id}`)
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

  revalidatePath(`/tickets/${ticket_id}`)
  return { status: 'success' }
}

export async function sendTicketMessage(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: senderProfile } = await supabase
    .from('profiles')
    .select('organization_id, full_name')
    .eq('id', user.id)
    .single()

  if (!senderProfile?.organization_id) return { status: 'error', error: 'No organization' }

  const ticket_id = formData.get('ticket_id') as string
  const body      = formData.get('body')      as string
  const type      = formData.get('type')      as string

  if (!ticket_id) return { status: 'error', error: 'Ticket is required' }
  if (!body?.trim()) return { status: 'error', error: 'Message cannot be empty' }
  if (type !== 'public' && type !== 'internal') {
    return { status: 'error', error: 'Invalid message type' }
  }

  // Confirm the ticket belongs to the sender's org before writing.
  // RLS would block a cross-org insert anyway, but failing fast gives
  // a friendlier error than a constraint violation.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, organization_id, display_id, subject, lead_id')
    .eq('id', ticket_id)
    .single()

  if (!ticket || ticket.organization_id !== senderProfile.organization_id) {
    return { status: 'error', error: 'Ticket not found' }
  }

  const trimmed = body.trim()

  const { error } = await supabase.from('ticket_messages').insert({
    ticket_id,
    org_id:    senderProfile.organization_id,
    sender_id: user.id,
    body:      trimmed,
    type,
  })

  if (error) return { status: 'error', error: error.message }

  if (type === 'public') {
    await dispatchOutboundEmail({
      supabase,
      orgId:         senderProfile.organization_id,
      senderName:    senderProfile.full_name,
      ticketId:      ticket.id,
      ticketLeadId:  ticket.lead_id,
      ticketSubject: ticket.subject,
      ticketDisplayId: ticket.display_id,
      body:          trimmed,
    })
  }

  revalidatePath(`/tickets/${ticket_id}`)
  return { status: 'success' }
}

type DispatchArgs = {
  supabase:        Awaited<ReturnType<typeof createClient>>
  orgId:           string
  senderName:      string | null
  ticketId:        string
  ticketLeadId:    string | null
  ticketSubject:   string
  ticketDisplayId: string | null
  body:            string
}

async function dispatchOutboundEmail(args: DispatchArgs) {
  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error('[ticket-email] POSTMARK_SERVER_TOKEN not set — skipping outbound email')
    return
  }

  const { data: org } = await args.supabase
    .from('organizations')
    .select('inbound_email_address, verified_support_email')
    .eq('id', args.orgId)
    .single()

  // Recipient comes from the linked lead. No lead → no public destination.
  if (!args.ticketLeadId) {
    console.error(`[ticket-email] ticket ${args.ticketId} has no lead — cannot send public reply`)
    return
  }

  const { data: lead } = await args.supabase
    .from('leads')
    .select('email, first_name, last_name')
    .eq('id', args.ticketLeadId)
    .single()

  if (!lead?.email) {
    console.error(`[ticket-email] lead ${args.ticketLeadId} has no email — skipping outbound email`)
    return
  }

  const displayId  = args.ticketDisplayId ?? args.ticketId
  const senderName = args.senderName || 'Support'

  // Use the org's verified support address when available; otherwise fall back
  // to the shared Kinvox mailbox so outbound never silently breaks.
  const fromAddress = org?.verified_support_email
    ? `${senderName} <${org.verified_support_email}>`
    : `${senderName} <support@kinvoxtech.com>`

  if (!org?.verified_support_email) {
    console.warn(`[ticket-email] org ${args.orgId} has no verified_support_email — sending from support@kinvoxtech.com`)
  }

  // Strip any pre-existing [tk_…] tag so we don't double-tag on follow-ups.
  const baseSubject = args.ticketSubject.replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()
  const subject = `[${displayId}] ${baseSubject || '(no subject)'}`

  const threadingId = `<${displayId}@kinvox.com>`

  const client = new ServerClient(token)

  try {
    const result = await client.sendEmail({
      From:    fromAddress,
      To:      lead.email,
      Subject: subject,
      TextBody: args.body,
      Headers: [
        { Name: 'References',  Value: threadingId },
        { Name: 'In-Reply-To', Value: threadingId },
      ],
    })
    console.log(`[ticket-email] dispatched ticket=${displayId} from="${fromAddress}" to=${lead.email} subject="${subject}" postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ticket-email] FAILED ticket=${displayId} to=${lead.email}: ${msg}`)
  }
}

type ClosureArgs = {
  supabase:        Awaited<ReturnType<typeof createClient>>
  ticketId:        string
  ticketLeadId:    string | null
  ticketSubject:   string
  ticketDisplayId: string | null
}

async function dispatchClosureEmail(args: ClosureArgs) {
  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error('[ticket-email] POSTMARK_SERVER_TOKEN not set — skipping closure notification')
    return
  }

  if (!args.ticketLeadId) {
    console.warn(`[ticket-email] ticket ${args.ticketId} has no lead — skipping closure notification`)
    return
  }

  const { data: lead } = await args.supabase
    .from('leads')
    .select('email')
    .eq('id', args.ticketLeadId)
    .single()

  if (!lead?.email) {
    console.warn(`[ticket-email] lead ${args.ticketLeadId} has no email — skipping closure notification`)
    return
  }

  const displayId   = args.ticketDisplayId ?? args.ticketId
  const baseSubject = args.ticketSubject.replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()
  const subject     = `[${displayId}] ${baseSubject || '(no subject)'}`
  const threadingId = `<${displayId}@kinvox.com>`

  const text = `Your ticket (${displayId}) has been marked as resolved. If you have further questions, simply reply to this email to reopen it.`

  const client = new ServerClient(token)
  try {
    const result = await client.sendEmail({
      From:    'Kinvox Support <support@kinvoxtech.com>',
      To:      lead.email,
      Subject: subject,
      TextBody: text,
      Headers: [
        { Name: 'References',  Value: threadingId },
        { Name: 'In-Reply-To', Value: threadingId },
      ],
    })
    console.log(`[ticket-email] closure notice dispatched ticket=${displayId} to=${lead.email} postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ticket-email] closure notice FAILED ticket=${displayId} to=${lead.email}: ${msg}`)
  }
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

