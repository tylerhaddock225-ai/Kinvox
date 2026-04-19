'use server'

import { ServerClient } from 'postmark'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { buildIcs } from '@/lib/ics'

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
  const lead_id     = formData.get('lead_id')     as string | null

  if (!title?.trim())  return { status: 'error', error: 'Title is required' }
  if (!start_at)       return { status: 'error', error: 'Start time is required' }

  const { data: created, error } = await supabase.from('appointments').insert({
    organization_id: profile.organization_id,
    created_by:  user.id,
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at   || null,
    location:    location || null,
    assigned_to: assigned_to || null,
    lead_id:     lead_id     || null,
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
    leadId:        lead_id || null,
    organizationId: profile.organization_id,
  })

  revalidatePath('/appointments')
  return { status: 'success' }
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('appointments').delete().eq('id', appointmentId)

  revalidatePath('/appointments')
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
  const lead_id     = formData.get('lead_id')     as string | null

  if (!title?.trim()) return { status: 'error', error: 'Title is required' }
  if (!start_at)      return { status: 'error', error: 'Start time is required' }

  const { error } = await supabase.from('appointments').update({
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at      || null,
    location:    location    || null,
    assigned_to: assigned_to || null,
    lead_id:     lead_id     || null,
  }).eq('id', appointmentId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/appointments')
  return { status: 'success' }
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
  organizationId: string
}

async function dispatchAppointmentNotifications(a: NotifyArgs) {
  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — skipping notifications`)
    return
  }

  const admin = createAdminClient()

  // Resolve org's verified support address (used as From) and lead/agent emails.
  const [orgRes, agentProfileRes, creatorAuthRes, leadRes] = await Promise.all([
    admin
      .from('organizations')
      .select('name, verified_support_email')
      .eq('id', a.organizationId)
      .single(),
    a.assignedToId
      ? admin.from('profiles').select('full_name, calendar_email').eq('id', a.assignedToId).single()
      : Promise.resolve({ data: null }),
    admin.auth.admin.getUserById(a.creatorId),
    a.leadId
      ? admin.from('leads').select('email, first_name, last_name').eq('id', a.leadId).single()
      : Promise.resolve({ data: null }),
  ])

  const org         = orgRes.data
  const fromAddress = org?.verified_support_email
    ? `${org.name ?? 'Kinvox'} <${org.verified_support_email}>`
    : 'Kinvox <support@kinvoxtech.com>'

  // Resolve target agent email — calendar_email override → auth email fallback.
  let agentEmail: string | null = null
  let agentName:  string | null = null
  if (a.assignedToId) {
    const p = (agentProfileRes.data ?? null) as { full_name: string | null; calendar_email: string | null } | null
    agentName = p?.full_name ?? null
    if (p?.calendar_email) {
      agentEmail = p.calendar_email
    } else {
      const { data: agentAuth } = await admin.auth.admin.getUserById(a.assignedToId)
      agentEmail = agentAuth?.user?.email ?? null
    }
  }

  const creatorEmail = creatorAuthRes.data?.user?.email ?? null
  const lead         = (leadRes.data ?? null) as { email: string | null; first_name: string; last_name: string | null } | null

  const start = new Date(a.startAt)
  const end   = a.endAt ? new Date(a.endAt) : new Date(start.getTime() + 30 * 60_000)

  const displayId = a.displayId ?? a.apptId
  const subject   = `[${displayId}] ${a.title}`

  const formatLocal = (d: Date) =>
    d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  const client = new ServerClient(token)

  // Determine attendees for ICS — agent and lead are participants; the creator
  // organizes (so the calendar shows the agent as host on the customer's view).
  const organizer = agentEmail
    ? { email: agentEmail, name: agentName ?? 'Kinvox' }
    : { email: creatorEmail ?? 'noreply@kinvoxtech.com', name: a.creatorName ?? 'Kinvox' }

  const attendees: { email: string; name?: string }[] = []
  if (lead?.email) attendees.push({ email: lead.email, name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || undefined })
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

  const icsAttachment = {
    Name:        'invite.ics',
    ContentType: 'text/calendar; method=REQUEST; charset=UTF-8',
    Content:     Buffer.from(ics, 'utf8').toString('base64'),
    ContentID:   null,
  }

  const sendOne = async (label: string, to: string, body: string, withIcs: boolean) => {
    try {
      const result = await client.sendEmail({
        From:    fromAddress,
        To:      to,
        Subject: subject,
        TextBody: body,
        Attachments: withIcs ? [icsAttachment] : undefined,
      })
      console.log(`${LOG} ${label} dispatched appt=${displayId} to=${to} postmark_id=${result.MessageID}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${LOG} ${label} FAILED appt=${displayId} to=${to}: ${msg}`)
    }
  }

  const isProxyBooking = !!(a.assignedToId && a.assignedToId !== a.creatorId)

  // 1. Target agent gets the meeting + ICS.
  if (agentEmail) {
    const body = [
      `${a.creatorName ?? 'A teammate'} booked a meeting on your calendar.`,
      '',
      `When:     ${formatLocal(start)} – ${formatLocal(end)}`,
      a.location ? `Where:    ${a.location}` : null,
      lead?.email ? `Customer: ${[lead.first_name, lead.last_name].filter(Boolean).join(' ')} <${lead.email}>` : null,
      a.description ? `\n${a.description}` : null,
    ].filter(Boolean).join('\n')
    await sendOne('agent-invite', agentEmail, body, true)
  } else {
    console.warn(`${LOG} skipping agent invite — appointment ${displayId} has no resolvable agent email`)
  }

  // 2. Booking-confirmed receipt to the support agent who created it.
  //    Only when proxying for someone else; otherwise the agent invite above already covered them.
  if (isProxyBooking && creatorEmail) {
    const body = [
      `Booking confirmed.`,
      '',
      `You scheduled "${a.title}" with ${agentName ?? 'the assigned agent'} on behalf of the customer.`,
      `When: ${formatLocal(start)} – ${formatLocal(end)}`,
      a.location ? `Where: ${a.location}` : null,
      '',
      'You\'ll receive a copy on your own calendar separately if you opt in to the appointment.',
    ].filter(Boolean).join('\n')
    await sendOne('creator-confirmation', creatorEmail, body, false)
  }

  // 3. Customer invite — agent appears as host (organizer above).
  if (lead?.email) {
    const customerBody = [
      `${agentName ?? 'Your contact'} from ${org?.name ?? 'Kinvox'} has scheduled a meeting with you.`,
      '',
      `When:  ${formatLocal(start)} – ${formatLocal(end)}`,
      a.location ? `Where: ${a.location}` : null,
      '',
      'The attached invite (.ics) will add this meeting to your calendar.',
    ].filter(Boolean).join('\n')
    await sendOne('customer-invite', lead.email, customerBody, true)
  }
}
