// Customer-facing lead-capture confirmation email.
//
// Default templates live here; per-org overrides come from
// organizations.confirmation_email_template (jsonb { subject, body }).
// Either subfield null falls back to the corresponding default.
//
// Token interpolation uses an explicit allowlist — no eval / Function /
// arbitrary-expression evaluation. HTML escaping is applied to the HTML
// render path so user-supplied custom_answers can't inject markup.

const DEFAULT_SUBJECT = 'We got your request — {orgName}'

const DEFAULT_BODY = `Hi {firstName},

Thanks for reaching out to {orgName}. We've received your information and someone from our team will follow up with you soon{appointmentLine}.

Here's what you submitted:

- Address: {serviceAddress}
- Phone: {phone}
{customAnswersBlock}

If anything looks wrong or you need to reach us in the meantime, just reply to this email — it goes straight to our team.

Talk soon,
The {orgName} team`

export type LeadConfirmationContext = {
  orgName:         string
  firstName:       string
  serviceAddress:  string
  phone:           string
  appointmentTime: string | null
  customAnswers:   Array<{ label: string; answer: string }>
  // Lead's display_id (e.g. "ld_9"). Prepended to the subject as
  // "[ld_<displayId>] …" so inbound replies route back to this lead via
  // the postmark-inbound webhook — same convention Tickets uses.
  leadDisplayId:   string | null
  override?: {
    subject: string | null
    body:    string | null
  } | null
}

export type RenderedEmail = {
  subject:  string
  htmlBody: string
  textBody: string
}

// Allowlist — any token outside this set renders as empty string.
type SupportedToken =
  | 'firstName'
  | 'orgName'
  | 'serviceAddress'
  | 'phone'
  | 'appointmentTime'
  | 'appointmentLine'
  | 'customAnswersBlock'

const SUPPORTED_TOKENS: ReadonlySet<SupportedToken> = new Set([
  'firstName',
  'orgName',
  'serviceAddress',
  'phone',
  'appointmentTime',
  'appointmentLine',
  'customAnswersBlock',
])

const TOKEN_RE = /\{([a-zA-Z]+)\}/g

function isSupportedToken(name: string): name is SupportedToken {
  return SUPPORTED_TOKENS.has(name as SupportedToken)
}

function interpolate(template: string, values: Record<SupportedToken, string>): string {
  return template.replace(TOKEN_RE, (_match, name: string) =>
    isSupportedToken(name) ? values[name] : '',
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildAppointmentLine(appointmentTime: string | null): string {
  if (!appointmentTime) return ''
  return ` — we have you scheduled for ${appointmentTime}`
}

function buildCustomAnswersTextBlock(
  customAnswers: LeadConfirmationContext['customAnswers'],
): string {
  if (!customAnswers.length) return ''
  const lines = customAnswers.map((c) => `- ${c.label}: ${c.answer}`).join('\n')
  return `\n${lines}`
}

function buildCustomAnswersHtmlBlock(
  customAnswers: LeadConfirmationContext['customAnswers'],
): string {
  if (!customAnswers.length) return ''
  const items = customAnswers
    .map((c) => `  <li>${escapeHtml(c.label)}: ${escapeHtml(c.answer)}</li>`)
    .join('\n')
  return `\n<ul>\n${items}\n</ul>`
}

// Convert a free-form text body (with embedded \n) into a deliverability-
// friendly HTML body: escape, split on double-newline into paragraphs,
// preserve single newlines as <br>. Used by the override path so a plain-
// text override becomes presentable HTML automatically; the default
// template uses bespoke HTML below for cleaner rendering of the bullet
// lists.
function textToHtmlParagraphs(text: string): string {
  const paragraphs = text.split(/\n{2,}/)
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

const HTML_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

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

// Bespoke HTML for the default body — uses the same logical structure as
// the text version (greeting, thanks, submission summary, sign-off) but
// with proper paragraph + list elements instead of plain text.
function renderDefaultHtmlBody(values: Record<SupportedToken, string>, raw: LeadConfirmationContext): string {
  const submissionItems: string[] = [
    `<li>Address: ${escapeHtml(raw.serviceAddress)}</li>`,
    `<li>Phone: ${escapeHtml(raw.phone)}</li>`,
  ]
  for (const c of raw.customAnswers) {
    submissionItems.push(`<li>${escapeHtml(c.label)}: ${escapeHtml(c.answer)}</li>`)
  }

  const orgName    = escapeHtml(raw.orgName)
  const firstName  = escapeHtml(raw.firstName)
  const apptSpan   = raw.appointmentTime
    ? ` — we have you scheduled for <strong>${escapeHtml(raw.appointmentTime)}</strong>`
    : ''
  // values is intentionally unused here; the bespoke HTML reads from raw
  // for type-safe access to the structured fields. The text path below
  // uses the interpolation helper for token substitution.
  void values

  return [
    `<p>Hi ${firstName},</p>`,
    `<p>Thanks for reaching out to <strong>${orgName}</strong>. We've received your information and someone from our team will follow up with you soon${apptSpan}.</p>`,
    `<p>Here's what you submitted:</p>`,
    `<ul>\n${submissionItems.map((i) => '  ' + i).join('\n')}\n</ul>`,
    `<p>If anything looks wrong or you need to reach us in the meantime, just reply to this email — it goes straight to our team.</p>`,
    `<p>Talk soon,<br>The ${orgName} team</p>`,
  ].join('\n')
}

export function renderLeadConfirmationEmail(
  ctx: LeadConfirmationContext,
): RenderedEmail {
  const subjectTemplate =
    ctx.override?.subject && ctx.override.subject.trim().length
      ? ctx.override.subject
      : DEFAULT_SUBJECT

  const bodyTemplate =
    ctx.override?.body && ctx.override.body.trim().length
      ? ctx.override.body
      : DEFAULT_BODY

  const usingDefaultBody = bodyTemplate === DEFAULT_BODY

  const textValues: Record<SupportedToken, string> = {
    firstName:           ctx.firstName,
    orgName:             ctx.orgName,
    serviceAddress:      ctx.serviceAddress,
    phone:               ctx.phone,
    appointmentTime:     ctx.appointmentTime ?? '',
    appointmentLine:     buildAppointmentLine(ctx.appointmentTime),
    customAnswersBlock:  buildCustomAnswersTextBlock(ctx.customAnswers),
  }

  const interpolatedSubject = interpolate(subjectTemplate, textValues)
  // Prepend [ld_<displayId>] tag — same shape Tickets uses ([tk_<id>]) so
  // the postmark-inbound webhook can route the lead's reply back into
  // this lead's conversation thread. Stripped before re-interpolation
  // wouldn't be needed here because we always start from a fresh template.
  const subject = ctx.leadDisplayId
    ? `[${ctx.leadDisplayId}] ${interpolatedSubject}`
    : interpolatedSubject
  const textBody = interpolate(bodyTemplate, textValues)

  // HTML render path:
  //  - default body: bespoke HTML with proper paragraph/list elements
  //  - override body: escape + paragraphify the text result so a plain-
  //    text override still arrives as presentable HTML
  const htmlInner = usingDefaultBody
    ? renderDefaultHtmlBody(textValues, ctx)
    : textToHtmlParagraphs(textBody)

  const htmlBody = wrapHtmlDocument(subject, htmlInner)

  return { subject, htmlBody, textBody }
}
