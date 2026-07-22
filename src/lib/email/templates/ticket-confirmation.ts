// Ticket confirmation (customer-facing "we got your message").
//
// Sent by the postmark-inbound webhook (Path C) when an inbound email creates
// a new customer→org ticket. Lets the sender know we received them and gives
// them the reference id so they can track the thread. Re-subjects on top of
// the original subject (with the original message subject preserved) so the
// reply lands as a threaded continuation in the recipient's mail client.
//
// Skipped when the sender looks like an auto-responder (noreply / mailer-daemon
// / postmaster / bounces) — see isLikelyAutoResponder in the webhook.

import { renderSmsOptInEmailSection } from './sms-opt-in-section'

export type TicketConfirmationContext = {
  orgName:         string
  ticketDisplayId: string
  originalSubject: string | null
  // SMS Stage 2a — public opt-in URL for the ticket's customer, or null when
  // none was minted (customerless ticket, already opted in, or mint failed).
  smsOptInUrl?:    string | null
}

export type RenderedTicketConfirmation = {
  subject:  string
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

export function renderTicketConfirmationEmail(
  ctx: TicketConfirmationContext,
): RenderedTicketConfirmation {
  // Defensive — the webhook strips [tk_…] before we get here, but if anything
  // changes upstream we still avoid double-tagging.
  const stripped = (ctx.originalSubject ?? '')
    .replace(/\[tk_[a-z0-9]+\]\s*/gi, '')
    .trim()

  const subject = stripped
    ? `[${ctx.ticketDisplayId}] Re: ${stripped}`
    : `[${ctx.ticketDisplayId}] We received your message`

  // SMS Stage 2a — optional "prefer text messages?" opt-in section, appended to
  // both bodies. Empty strings when no URL was minted, so this is a no-op then.
  const smsSection = renderSmsOptInEmailSection(ctx.smsOptInUrl)

  const textBody = [
    'Hi there,',
    '',
    `Thanks for reaching out to ${ctx.orgName}. We've received your message and someone from our team will follow up shortly.`,
    '',
    `Your reference: [${ctx.ticketDisplayId}]`,
    '',
    `— The ${ctx.orgName} team`,
  ].join('\n') + smsSection.text

  const orgNameSafe   = escapeHtml(ctx.orgName)
  const displayIdSafe = escapeHtml(ctx.ticketDisplayId)
  const htmlInner = [
    `<p>Hi there,</p>`,
    `<p>Thanks for reaching out to <strong>${orgNameSafe}</strong>. We've received your message and someone from our team will follow up shortly.</p>`,
    `<p>Your reference: <strong>[${displayIdSafe}]</strong></p>`,
    `<p>— The ${orgNameSafe} team</p>`,
  ].join('\n') + smsSection.html

  const htmlBody = wrapHtmlDocument(subject, htmlInner)
  return { subject, htmlBody, textBody }
}
