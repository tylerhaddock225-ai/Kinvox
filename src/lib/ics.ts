// Minimal RFC 5545 calendar generator. Just enough to make Gmail / Outlook /
// Apple Calendar render the attachment as an "Add to calendar" invite. If we
// outgrow this, swap for the `ics` package — keeping the call site narrow so
// the migration is a one-liner.

export type IcsAttendee = {
  email: string
  name?: string
  role?: 'REQ-PARTICIPANT' | 'OPT-PARTICIPANT'
}

export type IcsEvent = {
  uid:         string
  summary:     string
  description: string | null
  start:       Date
  end:         Date
  location?:   string | null
  organizer:   { email: string; name?: string }
  attendees:   IcsAttendee[]
  // METHOD: REQUEST is what most clients expect for an invite attachment.
  method?:     'REQUEST' | 'PUBLISH'
}

function toIcsDate(d: Date): string {
  // YYYYMMDDTHHmmssZ
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function fold(line: string): string {
  // RFC 5545 caps lines at 75 octets; longer lines are folded with CRLF + space.
  if (line.length <= 75) return line
  const chunks: string[] = []
  for (let i = 0; i < line.length; i += 73) chunks.push(line.slice(i, i + 73))
  return chunks.join('\r\n ')
}

export function buildIcs(event: IcsEvent): string {
  const method = event.method ?? 'REQUEST'

  const orgLine = event.organizer.name
    ? `ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}`
    : `ORGANIZER:mailto:${event.organizer.email}`

  const attendeeLines = event.attendees.map(a => {
    const cn   = a.name ? `;CN=${escapeText(a.name)}` : ''
    const role = `;ROLE=${a.role ?? 'REQ-PARTICIPANT'}`
    return `ATTENDEE${cn}${role};RSVP=TRUE:mailto:${a.email}`
  })

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kinvox//Appointments//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    event.location    ? `LOCATION:${escapeText(event.location)}`       : null,
    orgLine,
    ...attendeeLines,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[]

  return lines.map(fold).join('\r\n')
}
