// Conversation-reply email rendering for both lead and ticket public replies.
//
// Pure: no DB reads, no Postmark calls. Caller resolves the lead's first
// name, the replier's first name, the org name, the typed body, and the
// most recent prior public message in the thread (or null on first reply).
//
// Visual treatment mirrors lead-confirmation.ts — same font stack, same
// shell, same paragraph density — so the lead receives a consistent
// presentation across confirmation and follow-up replies. Quoted block
// uses Gmail's native left-border-and-indent style for HTML and standard
// "> " line prefixes for plain text.
//
// Helpers (escapeHtml, wrapHtmlDocument, font stack) are inline-copied
// from lead-confirmation.ts. Backlog: extract into _shared.ts when
// either file is touched again.

export type PriorMessage = {
  senderName: string
  sentAt:     Date
  body:       string
}

export type ConversationReplyContext = {
  leadFirstName:     string | null
  replierFirstName:  string | null
  orgName:           string
  body:              string
  prior:             PriorMessage | null
}

export type RenderedReply = {
  htmlBody: string
  textBody: string
}

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

function wrapHtmlDocument(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f6f6;">
<div style="max-width:580px;margin:0 auto;padding:24px;font-family:${HTML_FONT_STACK};font-size:15px;line-height:1.55;color:#1a1a1a;">
${inner}
</div>
</body>
</html>`
}

// Same Intl shape lead-confirmation uses for appointment time so the two
// surfaces read with one voice ("Wednesday, May 6 at 10:44 AM UTC").
function formatQuotedDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    weekday:      'long',
    month:        'long',
    day:          'numeric',
    hour:         'numeric',
    minute:       '2-digit',
    hour12:       true,
    timeZone:     'UTC',
    timeZoneName: 'short',
  }).format(d)
}

// Convert a free-form body (with embedded \n) into HTML paragraphs:
// escape, split on double-newline into <p>, preserve single newlines as
// <br>. Mirrors the lead-confirmation override path.
function bodyToHtmlParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs
    .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function bodyToQuotedHtmlParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs
    .map((p) => `<p style="margin:0 0 8px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function bodyToQuotedText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
}

// Greeting falls back to "Hi there," when the lead's first name is missing
// or a placeholder ("Unknown" is what lead-magnet capture writes when the
// visitor submits a blank name field).
function resolveGreetingName(leadFirstName: string | null): string {
  const trimmed = leadFirstName?.trim() ?? ''
  if (!trimmed) return 'there'
  if (trimmed.toLowerCase() === 'unknown') return 'there'
  return trimmed
}

// Sign-off uses the replier's first name when known, else falls back to
// the org-team form so the reader never sees an awkward generic "Support
// at <orgName>" line.
function renderSignoffHtml(replierFirstName: string | null, orgName: string): string {
  const name    = replierFirstName?.trim() ?? ''
  const orgEsc  = escapeHtml(orgName)
  if (name) {
    return `<p style="margin:24px 0 0;">— ${escapeHtml(name)} at ${orgEsc}</p>`
  }
  return `<p style="margin:24px 0 0;">— ${orgEsc} team</p>`
}

function renderSignoffText(replierFirstName: string | null, orgName: string): string {
  const name = replierFirstName?.trim() ?? ''
  if (name) return `— ${name} at ${orgName}`
  return `— ${orgName} team`
}

function renderQuotedHtml(prior: PriorMessage): string {
  const date   = formatQuotedDate(prior.sentAt)
  const sender = escapeHtml(prior.senderName.trim() || 'them')
  const inner  = bodyToQuotedHtmlParagraphs(prior.body)
  return `<blockquote style="margin:24px 0 0;padding:0 0 0 12px;border-left:3px solid #d0d0d0;color:#666;">
<p style="margin:0 0 8px;font-size:14px;">On ${escapeHtml(date)}, ${sender} wrote:</p>
${inner}
</blockquote>`
}

function renderQuotedText(prior: PriorMessage): string {
  const date    = formatQuotedDate(prior.sentAt)
  const sender  = prior.senderName.trim() || 'them'
  const quoted  = bodyToQuotedText(prior.body)
  return `On ${date}, ${sender} wrote:\n${quoted}`
}

export function renderConversationReply(ctx: ConversationReplyContext): RenderedReply {
  const greetingName = resolveGreetingName(ctx.leadFirstName)

  // HTML body — paragraph treatment mirrors lead-confirmation: <p> tags,
  // 12px bottom margin, line-height inherited from the wrapping <div>.
  const htmlInner = [
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(greetingName)},</p>`,
    bodyToHtmlParagraphs(ctx.body),
    renderSignoffHtml(ctx.replierFirstName, ctx.orgName),
    ctx.prior ? renderQuotedHtml(ctx.prior) : '',
  ].filter(Boolean).join('\n')

  // The <title> here is invisible to the recipient (it's only used by
  // some clients in the tab/preview chrome) — pass the org name as a
  // generic stand-in. The Postmark Subject is set by the caller.
  const htmlBody = wrapHtmlDocument(ctx.orgName, htmlInner)

  const textParts = [
    `Hi ${greetingName},`,
    '',
    ctx.body,
    '',
    renderSignoffText(ctx.replierFirstName, ctx.orgName),
  ]
  if (ctx.prior) {
    textParts.push('', renderQuotedText(ctx.prior))
  }
  const textBody = textParts.join('\n')

  return { htmlBody, textBody }
}
