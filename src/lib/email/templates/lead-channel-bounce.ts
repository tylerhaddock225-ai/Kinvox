// Lead-channel inbound bounce.
//
// Sent by the postmark-inbound webhook when mail arrives on the lead-channel
// address (lead-<orgSlug>@<domain>) but cannot be routed into an active lead
// conversation — either because no lead/sender match exists, or because the
// matched lead is in a terminal state (currently 'converted'). The customer
// is redirected to the org's verified support email.
//
// The webhook ONLY sends this when org.verified_support_email is set AND
// confirmed; if support isn't verified, the inbound is silently dropped
// rather than bouncing the visitor at a dead end.

export type LeadChannelBounceContext = {
  orgName:      string
  supportEmail: string
}

export type RenderedBounce = {
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

export function renderLeadChannelBounce(ctx: LeadChannelBounceContext): RenderedBounce {
  const subject = `We received your message — please reach us at ${ctx.supportEmail}`

  const textBody = [
    'Hi there,',
    '',
    `Thanks for reaching out to ${ctx.orgName}. The address you emailed isn't monitored for new conversations. For all inquiries, please contact us at ${ctx.supportEmail} and a team member will be in touch.`,
    '',
    `— The ${ctx.orgName} Team`,
  ].join('\n')

  const orgNameSafe      = escapeHtml(ctx.orgName)
  const supportEmailSafe = escapeHtml(ctx.supportEmail)
  const htmlInner = [
    `<p>Hi there,</p>`,
    `<p>Thanks for reaching out to <strong>${orgNameSafe}</strong>. The address you emailed isn't monitored for new conversations. For all inquiries, please contact us at <a href="mailto:${supportEmailSafe}">${supportEmailSafe}</a> and a team member will be in touch.</p>`,
    `<p>— The ${orgNameSafe} Team</p>`,
  ].join('\n')

  const htmlBody = wrapHtmlDocument(subject, htmlInner)
  return { subject, htmlBody, textBody }
}
