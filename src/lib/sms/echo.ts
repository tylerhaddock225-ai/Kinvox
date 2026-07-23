// Inbound-SMS → email echo — SMS Stage 2b.
//
// When a person texts an org (support or lead rail), their own words are echoed
// into their EMAIL thread so the inbox stays the complete source of truth for
// the conversation (canon: "the inbox is their source of truth"). This mirrors
// the rail's normal outbound email: same [tk_X]/[ld_X] subject tag, same Reply-To
// inbound address, same References/In-Reply-To threading id — so the echo lands
// in-thread and a reply from the inbox routes straight back through the email
// webhook.
//
// The echo is the CUSTOMER's message, not an org reply, so it is NOT run through
// renderConversationReply (that template adds an org greeting + sign-off). Body
// is framed plainly: "Text message received from <national-format phone>:".
//
// Fail-open: a send failure is logged under '[sms-echo]' and swallowed — an echo
// miss must never reject the inbound row that was already written, and the
// route itself never sends SMS (the echo is email-only).

import 'server-only'
import { sendOrgTransactionalEmail, type OrgEmailContext } from '@/lib/email/send-org-email'
import { formatPhoneDisplay } from '@/lib/phone'

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

// Render the framed body into HTML paragraphs (double-newline → <p>, single → <br>).
function bodyToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

export type EchoInboundSmsParams = {
  rail:        'support' | 'lead'
  org:         OrgEmailContext
  toEmail:     string
  subject:     string        // fully-built subject incl. the [tk_X]/[ld_X] tag
  replyTo:     string | null  // rail inbound address, or null when unconstructable
  threadingId: string        // "<display_id@kinvox.com>" for References/In-Reply-To
  fromPhone:   string        // the sender's number (E.164), rendered for the header
  body:        string        // the raw inbound SMS body
}

/**
 * Echo an inbound SMS into the person's email thread on the given rail.
 * Best-effort + fail-open (never throws).
 */
export async function echoInboundSmsToEmail(p: EchoInboundSmsParams): Promise<void> {
  const LOG = '[sms-echo]'
  try {
    const framed = `Text message received from ${formatPhoneDisplay(p.fromPhone)}:\n\n${p.body}`

    const htmlInner = bodyToHtmlParagraphs(framed)
    const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(p.subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f6f6;">
<div style="max-width:580px;margin:0 auto;padding:24px;font-family:${HTML_FONT_STACK};font-size:15px;line-height:1.55;color:#1a1a1a;">
${htmlInner}
</div>
</body>
</html>`

    const result = await sendOrgTransactionalEmail({
      org:               p.org,
      to:                p.toEmail,
      subject:           p.subject,
      htmlBody,
      textBody:          framed,
      replyTo:           p.replyTo ?? undefined,
      tag:               p.rail === 'support' ? 'ticket-sms-echo' : 'lead-sms-echo',
      fromAddressSource: p.rail === 'support' ? 'support' : 'lead',
      headers: [
        { Name: 'References',  Value: p.threadingId },
        { Name: 'In-Reply-To', Value: p.threadingId },
      ],
    })

    if (!result.ok) {
      console.error(`${LOG} FAILED rail=${p.rail} to=${p.toEmail}: ${result.error}`)
    } else {
      console.log(`${LOG} ok rail=${p.rail} to=${p.toEmail} postmark_id=${result.messageId}`)
    }
  } catch (err) {
    console.error(`${LOG} threw rail=${p.rail} to=${p.toEmail}:`, err)
  }
}
