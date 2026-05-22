'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidateOrgPath } from '@/lib/impersonation'
import { buildIcs } from '@/lib/ics'
import { sendOrgTransactionalEmail, type EmailAttachment } from '@/lib/email/send-org-email'
import { resolveProfileEmail } from '@/lib/email/resolve-profile-email'
import {
  renderAppointmentAgentInvite,
  renderAppointmentCreatorConfirmation,
  renderAppointmentRecipientInvite,
} from '@/lib/email/templates/appointment-invite'

export type State = { status: 'success' } | { status: 'error'; error: string } | null

const LOG = '[appt-email]'

export async function createAppointment(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization' }

  const title       = formData.get('title')       as string
  const description = formData.get('description') as string | null
  const start_at    = formData.get('start_at')    as string
  const end_at      = formData.get('end_at')      as string | null
  const location    = formData.get('location')    as string | null
  const assigned_to = formData.get('assigned_to') as string | null
  const customer_id = formData.get('customer_id') as string | null
  const lead_id_raw = formData.get('lead_id')     as string | null

  if (!title?.trim())  return { status: 'error', error: 'Title is required' }
  if (!start_at)       return { status: 'error', error: 'Start time is required' }

  const link = await resolveCustomerLink(supabase, profile.organization_id, customer_id, lead_id_raw)

  const { data: created, error } = await supabase.from('appointments').insert({
    organization_id: profile.organization_id,
    created_by:  user.id,
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at   || null,
    location:    location || null,
    assigned_to: assigned_to || null,
    customer_id: link.customerId,
    lead_id:     link.leadId,
    status:      'scheduled',
  }).select('id, display_id').single()

  if (error) return { status: 'error', error: error.message }

  // Fire-and-forget notifications. Failures here log but never block creation.
  void dispatchAppointmentNotifications({
    apptId:        created.id,
    displayId:     created.display_id,
    title:         title.trim(),
    description:   description || null,
    startAt:       start_at,
    endAt:         end_at || null,
    location:      location || null,
    creatorId:     user.id,
    creatorName:   profile.full_name,
    assignedToId:  assigned_to || null,
    leadId:        link.leadId,
    customerId:    link.customerId,
    organizationId: profile.organization_id,
  })

  await revalidateOrgPath(supabase, profile.organization_id, '/appointments')
  return { status: 'success' }
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Resolve the appointment's org BEFORE the delete so we can revalidate
  // the scoped path afterward (the row is gone post-delete; can't look up).
  const { data: existing } = await supabase
    .from('appointments')
    .select('organization_id')
    .eq('id', appointmentId)
    .maybeSingle<{ organization_id: string }>()

  await supabase.from('appointments').delete().eq('id', appointmentId)

  if (existing?.organization_id) {
    await revalidateOrgPath(supabase, existing.organization_id, '/appointments')
  }
}

export async function updateAppointment(
  appointmentId: string,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const title       = formData.get('title')       as string
  const description = formData.get('description') as string | null
  const start_at    = formData.get('start_at')    as string
  const end_at      = formData.get('end_at')      as string | null
  const location    = formData.get('location')    as string | null
  const assigned_to = formData.get('assigned_to') as string | null
  const customer_id = formData.get('customer_id') as string | null
  const lead_id_raw = formData.get('lead_id')     as string | null

  if (!title?.trim()) return { status: 'error', error: 'Title is required' }
  if (!start_at)      return { status: 'error', error: 'Start time is required' }

  // Resolve org from the appointment row so the helper can scope safely.
  const { data: existing } = await supabase
    .from('appointments')
    .select('organization_id')
    .eq('id', appointmentId)
    .single()
  if (!existing) return { status: 'error', error: 'Appointment not found' }

  const link = await resolveCustomerLink(supabase, existing.organization_id, customer_id, lead_id_raw)

  const { error } = await supabase.from('appointments').update({
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at      || null,
    location:    location    || null,
    assigned_to: assigned_to || null,
    customer_id: link.customerId,
    lead_id:     link.leadId,
  }).eq('id', appointmentId)

  if (error) return { status: 'error', error: error.message }

  await revalidateOrgPath(supabase, existing.organization_id, '/appointments')
  return { status: 'success' }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Resolve {customer_id, lead_id} from whatever the caller posted. Modal forms
// submit customer_id; older flows may submit lead_id. Always scoped by orgId
// so a stale customer_id pointing at another org silently downgrades to nulls
// rather than leaking across tenants.
async function resolveCustomerLink(
  supabase:   Awaited<ReturnType<typeof createClient>>,
  orgId:      string,
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

// ── Notifications ───────────────────────────────────────────────────────────

type NotifyArgs = {
  apptId:         string
  displayId:      string | null
  title:          string
  description:    string | null
  startAt:        string
  endAt:          string | null
  location:       string | null
  creatorId:      string
  creatorName:    string | null
  assignedToId:   string | null
  leadId:         string | null
  customerId:     string | null
  organizationId: string
}

async function dispatchAppointmentNotifications(a: NotifyArgs) {
  const admin = createAdminClient()

  // Widened SELECT — pulls everything sendOrgTransactionalEmail needs to
  // resolve the From address with _confirmed_at gating for BOTH channels.
  const [orgRes, agentProfileRes, creatorAuthRes] = await Promise.all([
    admin
      .from('organizations')
      .select('id, name, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at')
      .eq('id', a.organizationId)
      .single(),
    a.assignedToId
      ? admin
          .from('profiles')
          .select('id, full_name, calendar_email, is_org_inbox, org_inbox_kind, organization_id')
          .eq('id', a.assignedToId)
          .single()
      : Promise.resolve({ data: null }),
    admin.auth.admin.getUserById(a.creatorId),
  ])

  const org = orgRes.data
  if (!org) {
    console.error(`${LOG} org ${a.organizationId} not found — skipping notifications appt=${a.displayId ?? a.apptId}`)
    return
  }

  // Resolve target agent email. Pseudo-agent inbox profiles (is_org_inbox=true,
  // e.g. Lead Email) route through resolveProfileEmail to the org's verified
  // channel address; real users get calendar_email > auth.users.email.
  let agentEmail: string | null = null
  let agentName:  string | null = null
  // Default the From channel to 'support'. resolveProfileEmail overrides to
  // 'lead' for the Lead Email pseudo-agent. 'platform' would only arrive when
  // the profile is missing — in that case agentEmail is null and we skip the
  // send below, so the default never reaches Postmark.
  let agentFromAddressSource: 'support' | 'lead' = 'support'
  if (a.assignedToId) {
    const p = (agentProfileRes.data ?? null) as { full_name: string | null } | null
    agentName = p?.full_name ?? null

    const resolved = await resolveProfileEmail(admin, a.assignedToId)
    agentEmail = resolved.email
    if (resolved.fromAddressSource !== 'platform') {
      agentFromAddressSource = resolved.fromAddressSource
    }

    if (!agentEmail) {
      console.warn(
        `${LOG} no deliverable email for assignee assignedToId=${a.assignedToId} isInbox=${resolved.isInbox} inboxKind=${resolved.inboxKind ?? '-'} — skipping agent send`,
      )
    }
  }

  const creatorEmail = creatorAuthRes.data?.user?.email ?? null

  // Workstream F — resolve the attendee from EITHER the lead or the customer
  // path. The org has two verified-sender channels; the recipient send must
  // pick the matching one (lead → verified_lead_email, customer →
  // verified_support_email). leadId wins when both are set, matching the
  // pre-Workstream-F behavior where lead linkage was the only path.
  let attendeeEmail:     string | null = null
  let attendeeName:      string | null = null
  let attendeeFirstName: string | null = null
  let attendeeChannel:   'lead' | 'support' = 'support'

  if (a.leadId) {
    const { data: lead } = await admin
      .from('leads')
      .select('email, first_name, last_name')
      .eq('id', a.leadId)
      .maybeSingle<{ email: string | null; first_name: string | null; last_name: string | null }>()
    if (lead) {
      attendeeEmail     = lead.email ?? null
      attendeeFirstName = lead.first_name ?? null
      attendeeName      = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
      attendeeChannel   = 'lead'
    }
  } else if (a.customerId) {
    const { data: customer } = await admin
      .from('customers')
      .select('email, first_name, last_name')
      .eq('id', a.customerId)
      .maybeSingle<{ email: string | null; first_name: string | null; last_name: string | null }>()
    if (customer) {
      attendeeEmail     = customer.email ?? null
      attendeeFirstName = customer.first_name ?? null
      attendeeName      = [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || null
      attendeeChannel   = 'support'
    }
  }

  const start = new Date(a.startAt)
  const end   = a.endAt ? new Date(a.endAt) : new Date(start.getTime() + 30 * 60_000)
  const displayId = a.displayId ?? a.apptId

  const formatLocal = (d: Date) =>
    d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const startLocal = formatLocal(start)
  const endLocal   = formatLocal(end)

  // ICS — agent organizes (so calendar clients show them as host on the
  // recipient's view). Falls back to creator if no agent. Attendees = the
  // resolved recipient (lead or customer) + the agent when distinct.
  const organizer = agentEmail
    ? { email: agentEmail, name: agentName ?? 'Kinvox' }
    : { email: creatorEmail ?? 'noreply@kinvoxtech.com', name: a.creatorName ?? 'Kinvox' }

  const attendees: { email: string; name?: string }[] = []
  if (attendeeEmail) attendees.push({ email: attendeeEmail, name: attendeeName ?? undefined })
  if (agentEmail && agentEmail !== organizer.email) attendees.push({ email: agentEmail, name: agentName ?? undefined })

  const ics = buildIcs({
    uid:         `${a.apptId}@kinvox.com`,
    summary:     a.title,
    description: a.description,
    start, end,
    location:    a.location,
    organizer,
    attendees,
  })

  const icsAttachment: EmailAttachment = {
    name:        'invite.ics',
    contentType: 'text/calendar; method=REQUEST; charset=UTF-8',
    content:     Buffer.from(ics, 'utf8').toString('base64'),
    contentId:   null,
  }

  // Message-ID matches the existing ICS UID (kinvox.com domain) so future
  // reschedule / cancel emails can In-Reply-To / References this id and
  // thread in the recipient's mail client without a separate id lookup.
  // kinvox.com vs kinvoxtech.com divergence is pre-existing — not this
  // workstream's job to reconcile.
  const threadingId     = `<${a.apptId}@kinvox.com>`
  const threadingHeader = { Name: 'Message-ID', Value: threadingId }

  const orgCtx = {
    id:                                  org.id,
    name:                                org.name,
    verified_support_email:              org.verified_support_email,
    verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
    verified_lead_email:                 org.verified_lead_email,
    verified_lead_email_confirmed_at:    org.verified_lead_email_confirmed_at,
  }

  const isProxyBooking = !!(a.assignedToId && a.assignedToId !== a.creatorId)

  // 1. Agent invite — always fires when agentEmail resolves.
  if (agentEmail) {
    const tpl = renderAppointmentAgentInvite({
      orgName:          org.name,
      displayId,
      appointmentTitle: a.title,
      startLocal,
      endLocal,
      location:         a.location,
      description:      a.description,
      bookedByName:     a.creatorName,
      attendeeName,
      attendeeEmail,
    })
    const result = await sendOrgTransactionalEmail({
      org:               orgCtx,
      to:                agentEmail,
      subject:           tpl.subject,
      htmlBody:          tpl.htmlBody,
      textBody:          tpl.textBody,
      fromAddressSource: agentFromAddressSource,
      tag:               'appointment-agent',
      attachments:       [icsAttachment],
      headers:           [threadingHeader],
    })
    if (!result.ok) {
      console.error(`${LOG} agent-invite FAILED appt=${displayId} to=${agentEmail}: ${result.error}`)
    } else {
      console.log(`${LOG} agent-invite dispatched appt=${displayId} to=${agentEmail} postmark_id=${result.messageId}`)
    }
  } else {
    console.warn(`${LOG} skipping agent invite — appointment ${displayId} has no resolvable agent email`)
  }

  // 2. Creator confirmation — only fires when proxy-booking AND creatorEmail.
  //    Workstream F decision 2B: now WITH ICS attachment (previously omitted).
  if (isProxyBooking && creatorEmail) {
    const tpl = renderAppointmentCreatorConfirmation({
      orgName:          org.name,
      displayId,
      appointmentTitle: a.title,
      startLocal,
      endLocal,
      location:         a.location,
      agentName,
      attendeeName,
      attendeeEmail,
    })
    const result = await sendOrgTransactionalEmail({
      org:               orgCtx,
      to:                creatorEmail,
      subject:           tpl.subject,
      htmlBody:          tpl.htmlBody,
      textBody:          tpl.textBody,
      fromAddressSource: 'support',
      tag:               'appointment-creator',
      attachments:       [icsAttachment],
      headers:           [threadingHeader],
    })
    if (!result.ok) {
      console.error(`${LOG} creator-confirmation FAILED appt=${displayId} to=${creatorEmail}: ${result.error}`)
    } else {
      console.log(`${LOG} creator-confirmation dispatched appt=${displayId} to=${creatorEmail} postmark_id=${result.messageId}`)
    }
  }

  // 3. Recipient invite — fires when attendeeEmail resolves (lead or customer).
  //    fromAddressSource picks the From channel by attendee type — fixes the
  //    May 21 lead-channel from-address bug.
  if (attendeeEmail) {
    const tpl = renderAppointmentRecipientInvite({
      orgName:           org.name,
      displayId,
      appointmentTitle:  a.title,
      startLocal,
      endLocal,
      location:          a.location,
      agentName,
      attendeeFirstName,
    })
    const result = await sendOrgTransactionalEmail({
      org:               orgCtx,
      to:                attendeeEmail,
      subject:           tpl.subject,
      htmlBody:          tpl.htmlBody,
      textBody:          tpl.textBody,
      fromAddressSource: attendeeChannel,
      tag:               'appointment-recipient',
      attachments:       [icsAttachment],
      headers:           [threadingHeader],
    })
    if (!result.ok) {
      console.error(`${LOG} recipient-invite FAILED appt=${displayId} to=${attendeeEmail}: ${result.error}`)
    } else {
      console.log(`${LOG} recipient-invite dispatched appt=${displayId} to=${attendeeEmail} channel=${attendeeChannel} postmark_id=${result.messageId}`)
    }
  }
}
