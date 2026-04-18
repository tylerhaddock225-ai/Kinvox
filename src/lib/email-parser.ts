// Strip quoted reply trails and signatures from inbound email bodies so the
// stored `ticket_messages.body` only contains what the sender actually wrote.

const REPLY_DELIMITERS: RegExp[] = [
  // Explicit Kinvox / helpdesk markers
  /^[ \t>]*-{2,}\s*reply above this line\s*-{2,}.*$/im,
  /^[ \t>]*##- please type your reply above this line -##.*$/im,

  // Common email-client headers introducing a quoted reply
  /^[ \t>]*on\s.+?wrote:\s*$/im,
  /^[ \t>]*on\s.+?\s+at\s.+?\s+\S+\s+<[^>]+>\s+wrote:\s*$/im,
  /^[ \t>]*from:\s.+$/im,
  /^[ \t>]*-{2,}\s*original message\s*-{2,}.*$/im,
  /^[ \t>]*-{2,}\s*forwarded message\s*-{2,}.*$/im,
  /^[ \t>]*_{5,}\s*$/im,
]

const SIGNATURE_DELIMITERS: RegExp[] = [
  /^-- ?$/m,                          // RFC 3676 signature separator
  /^sent from my (iphone|ipad|android|samsung|phone).*$/im,
  /^get outlook for (ios|android).*$/im,
]

function cutAt(text: string, patterns: RegExp[]): string {
  let earliest = text.length
  for (const re of patterns) {
    const m = re.exec(text)
    if (m && m.index < earliest) earliest = m.index
  }
  return text.slice(0, earliest)
}

function stripQuotedLines(text: string): string {
  // Drop trailing blocks made entirely of `>`-prefixed quote lines.
  const lines = text.split(/\r?\n/)
  while (lines.length > 0) {
    const last = lines[lines.length - 1]
    if (/^[ \t]*>/.test(last) || last.trim() === '') {
      lines.pop()
    } else {
      break
    }
  }
  return lines.join('\n')
}

export function cleanEmailBody(raw: string | null | undefined): string {
  if (!raw) return ''

  let text = raw.replace(/\r\n/g, '\n')

  text = cutAt(text, REPLY_DELIMITERS)
  text = stripQuotedLines(text)
  text = cutAt(text, SIGNATURE_DELIMITERS)

  return text.trim()
}
