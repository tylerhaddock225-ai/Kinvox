// Outbound SMS body framing — SMS Stage 2b.
//
// Every org→person SMS carries a header line, a blank line, then the raw reply
// body. The header is the THREAD KEY: it embeds the bracketed display-id tag
// ([tk_X] on the support rail, [ld_X] on the lead rail) that the inbound webhook
// parses (TICKET_TAG_RE / LEAD_TAG_RE) to route a reply back to the same
// conversation. Pure string builders — no I/O.
//
//   ticket → "[tk_31] <subject, truncated so the header stays ≤ ~60 chars>\n\n<body>"
//   lead   → "[ld_7] <org name>\n\n<body>"
//
// Both are hard-capped at Twilio's 1600-char concatenated-message limit; the
// send helper (sendOrgSms) also truncates defensively, so this cap is belt-and-
// braces. The display-id passed in already includes its tk_/ld_ prefix (it is
// the row's display_id, e.g. 'tk_31'), so `[${displayId}]` reproduces the exact
// tag the inbound matcher expects.

import 'server-only'

// Twilio's hard cap for a single (concatenated) message body.
const MAX_TOTAL   = 1600
// Keep the header line short so it reads as a subject line, not a wall of text.
const MAX_HEADER  = 60

// Truncate to `n` chars with a trailing ellipsis (plain '...' to stay GSM-7 and
// avoid forcing a UCS-2 encoding on an otherwise-ASCII header).
function truncate(s: string, n: number): string {
  if (n <= 0) return ''
  if (s.length <= n) return s
  if (n <= 3) return s.slice(0, n)
  return s.slice(0, n - 3).trimEnd() + '...'
}

function capTotal(text: string): string {
  return text.length > MAX_TOTAL ? text.slice(0, MAX_TOTAL) : text
}

export function buildTicketSmsText(args: {
  displayId: string
  subject:   string | null
  body:      string
}): string {
  const prefix  = `[${args.displayId}] `
  const avail   = MAX_HEADER - prefix.length
  const subject = truncate((args.subject ?? '').trim(), Math.max(0, avail))
  const header  = subject ? `${prefix}${subject}` : prefix.trimEnd()
  return capTotal(`${header}\n\n${args.body}`)
}

export function buildLeadSmsText(args: {
  displayId: string
  orgName:   string
  body:      string
}): string {
  const prefix  = `[${args.displayId}] `
  const avail   = MAX_HEADER - prefix.length
  const orgName = truncate((args.orgName ?? '').trim(), Math.max(0, avail))
  const header  = orgName ? `${prefix}${orgName}` : prefix.trimEnd()
  return capTotal(`${header}\n\n${args.body}`)
}
