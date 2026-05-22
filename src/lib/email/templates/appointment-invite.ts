// Appointment invite templates (Workstream F).
//
// Three renderers, one per recipient class in the appointment fan-out:
//   - renderAppointmentAgentInvite       → the assigned agent
//   - renderAppointmentCreatorConfirmation → the booker, when proxy-booking
//   - renderAppointmentRecipientInvite   → the lead or customer attendee
//
// All three emit { subject, htmlBody, textBody } in the same shape as
// renderTicketConfirmationEmail / renderLeadChannelBounce. The actual ICS
// attachment is built and attached by the dispatcher (actions/appointments.ts)
// — these templates only produce the message body.
//
// Subject convention shared with the existing inline pattern:
//   `[${displayId}] ${appointmentTitle}`  e.g. `[ap_47] Project kickoff`

const HTML_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wrapHtmlDocument(subject: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f6f6;">
<div style="max-width:580px;margin:0 auto;padding:24px;font-family:${HTML_FONT_STACK};font-size:15px;line-height:1.55;color:#1a1a1a;">
${inner}
</div>
</body>
</html>`
}

// Renders the appointment detail block (When/Where/With/Attendee) as a
// table-like vertical list. Used by all three templates so any future schema
// addition (timezone hint, video-conference URL) gets reflected everywhere.
function renderDetailsHtml(rows: Array<{ label: string; value: string }>): string {
  return rows
    .map(r =>
      `<p style="margin:4px 0;"><strong>${escapeHtml(r.label)}</strong> ${escapeHtml(r.value)}</p>`,
    )
    .join('\n')
}

function buildSubject(displayId: string, title: string): string {
  return `[${displayId}] ${title}`
}

// ─── Agent invite ──────────────────────────────────────────────────────────

export type AgentInviteContext = {
  orgName:          string
  displayId:        string
  appointmentTitle: string
  startLocal:       string
  endLocal:         string
  location:         string | null
  description:      string | null
  bookedByName:     string | null
  attendeeName:     string | null
  attendeeEmail:    string | null
}

export type RenderedAppointmentEmail = {
  subject:  string
  htmlBody: string
  textBody: string
}

export function renderAppointmentAgentInvite(
  ctx: AgentInviteContext,
): RenderedAppointmentEmail {
  const subject  = buildSubject(ctx.displayId, ctx.appointmentTitle)
  const attendee = ctx.attendeeName ?? ctx.attendeeEmail ?? '(no attendee on file)'
  const booker   = ctx.bookedByName ?? 'a team member'
  const location = ctx.location ?? '(not specified)'

  const textLines: Array<string | null> = [
    'Hi there,',
    '',
    `You have a new appointment scheduled by ${booker} at ${ctx.orgName}.`,
    '',
    `Appointment: ${ctx.appointmentTitle}`,
    `When: ${ctx.startLocal} — ${ctx.endLocal}`,
    `Location: ${location}`,
    `With: ${attendee}`,
    ctx.description ? '' : null,
    ctx.description ? `Notes: ${ctx.description}` : null,
    '',
    'A calendar invite is attached to this email.',
    '',
    `— The ${ctx.orgName} team`,
  ]
  const textBody = textLines.filter((l): l is string => l !== null).join('\n')

  const orgSafe   = escapeHtml(ctx.orgName)
  const titleSafe = escapeHtml(ctx.appointmentTitle)
  const idSafe    = escapeHtml(ctx.displayId)
  const details   = renderDetailsHtml([
    { label: 'Appointment:', value: ctx.appointmentTitle },
    { label: 'When:',        value: `${ctx.startLocal} — ${ctx.endLocal}` },
    { label: 'Location:',    value: location },
    { label: 'With:',        value: attendee },
  ])
  const notesBlock = ctx.description
    ? `<p style="margin:16px 0 4px 0;"><strong>Notes</strong></p>
<p style="margin:0;white-space:pre-wrap;">${escapeHtml(ctx.description)}</p>`
    : ''

  const htmlInner = [
    `<p>Hi there,</p>`,
    `<p>You have a new appointment scheduled by <strong>${escapeHtml(booker)}</strong> at <strong>${orgSafe}</strong>. Reference: <strong>[${idSafe}] ${titleSafe}</strong></p>`,
    details,
    notesBlock,
    `<p style="margin-top:16px;">A calendar invite is attached to this email.</p>`,
    `<p>— The ${orgSafe} team</p>`,
  ].filter(Boolean).join('\n')

  return { subject, htmlBody: wrapHtmlDocument(subject, htmlInner), textBody }
}

// ─── Creator confirmation (proxy-booking only) ─────────────────────────────

export type CreatorConfirmationContext = {
  orgName:          string
  displayId:        string
  appointmentTitle: string
  startLocal:       string
  endLocal:         string
  location:         string | null
  agentName:        string | null
  attendeeName:     string | null
  attendeeEmail:    string | null
}

export function renderAppointmentCreatorConfirmation(
  ctx: CreatorConfirmationContext,
): RenderedAppointmentEmail {
  const subject  = buildSubject(ctx.displayId, ctx.appointmentTitle)
  const attendee = ctx.attendeeName ?? ctx.attendeeEmail ?? '(no attendee on file)'
  const agent    = ctx.agentName ?? 'an agent'
  const location = ctx.location ?? '(not specified)'

  const textBody = [
    'Hi there,',
    '',
    `This confirms that you've booked an appointment on behalf of ${agent} at ${ctx.orgName}.`,
    '',
    `Appointment: ${ctx.appointmentTitle}`,
    `When: ${ctx.startLocal} — ${ctx.endLocal}`,
    `Location: ${location}`,
    `Attendee: ${attendee}`,
    '',
    'A calendar invite is attached to this email.',
    '',
    `— The ${ctx.orgName} team`,
  ].join('\n')

  const orgSafe   = escapeHtml(ctx.orgName)
  const titleSafe = escapeHtml(ctx.appointmentTitle)
  const idSafe    = escapeHtml(ctx.displayId)
  const details   = renderDetailsHtml([
    { label: 'Appointment:', value: ctx.appointmentTitle },
    { label: 'When:',        value: `${ctx.startLocal} — ${ctx.endLocal}` },
    { label: 'Location:',    value: location },
    { label: 'Attendee:',    value: attendee },
  ])

  const htmlInner = [
    `<p>Hi there,</p>`,
    `<p>This confirms that you've booked an appointment on behalf of <strong>${escapeHtml(agent)}</strong> at <strong>${orgSafe}</strong>. Reference: <strong>[${idSafe}] ${titleSafe}</strong></p>`,
    details,
    `<p style="margin-top:16px;">A calendar invite is attached to this email.</p>`,
    `<p>— The ${orgSafe} team</p>`,
  ].join('\n')

  return { subject, htmlBody: wrapHtmlDocument(subject, htmlInner), textBody }
}

// ─── Recipient invite (lead or customer) ───────────────────────────────────

export type RecipientInviteContext = {
  orgName:           string
  displayId:         string
  appointmentTitle:  string
  startLocal:        string
  endLocal:          string
  location:          string | null
  agentName:         string | null
  attendeeFirstName: string | null
}

export function renderAppointmentRecipientInvite(
  ctx: RecipientInviteContext,
): RenderedAppointmentEmail {
  const subject  = buildSubject(ctx.displayId, ctx.appointmentTitle)
  const greeting = ctx.attendeeFirstName?.trim() || 'there'
  const contact  = ctx.agentName ?? 'Our team'
  const location = ctx.location ?? 'To be confirmed'

  const textBody = [
    `Hi ${greeting},`,
    '',
    `Your appointment with ${ctx.orgName} has been scheduled.`,
    '',
    `Appointment: ${ctx.appointmentTitle}`,
    `When: ${ctx.startLocal} — ${ctx.endLocal}`,
    `Location: ${location}`,
    `Your contact: ${contact}`,
    '',
    'A calendar invite is attached to this email — add it to your calendar to receive reminders.',
    '',
    'We look forward to meeting with you. If you need to reschedule, please reply to this email.',
    '',
    `— The ${ctx.orgName} team`,
  ].join('\n')

  const orgSafe   = escapeHtml(ctx.orgName)
  const titleSafe = escapeHtml(ctx.appointmentTitle)
  const idSafe    = escapeHtml(ctx.displayId)
  const details   = renderDetailsHtml([
    { label: 'Appointment:',  value: ctx.appointmentTitle },
    { label: 'When:',         value: `${ctx.startLocal} — ${ctx.endLocal}` },
    { label: 'Location:',     value: location },
    { label: 'Your contact:', value: contact },
  ])

  const htmlInner = [
    `<p>Hi ${escapeHtml(greeting)},</p>`,
    `<p>Your appointment with <strong>${orgSafe}</strong> has been scheduled. Reference: <strong>[${idSafe}] ${titleSafe}</strong></p>`,
    details,
    `<p style="margin-top:16px;">A calendar invite is attached to this email — add it to your calendar to receive reminders.</p>`,
    `<p>We look forward to meeting with you. If you need to reschedule, please reply to this email.</p>`,
    `<p>— The ${orgSafe} team</p>`,
  ].join('\n')

  return { subject, htmlBody: wrapHtmlDocument(subject, htmlInner), textBody }
}
