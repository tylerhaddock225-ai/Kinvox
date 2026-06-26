// HQ invite template (Workstream J revised, Stage 2).
//
// Renders the platform-side "join the Kinvox team" invitation email — the HQ
// parallel of renderTeamInviteEmail (team-invite.ts). Emits { subject, htmlBody,
// textBody } in the same shape. The dispatch site
// (hq/settings/users/actions.ts → inviteHqUser) hands the result to
// sendPlatformEmail, which owns the Kinvox From address — so this template
// carries NO From branding, mirroring team-invite.
//
// Unlike team-invite there is NO org context: HQ invites are always
// Kinvox-branded. Visual shell deliberately mirrors team-invite (conversational
// paragraphs, inline text link whose display text == href, no CTA pill).

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

export function renderHqInviteEmail(params: {
  inviterName:  string | null
  roleName:     string | null
  inviteUrl:    string
  expiresAt:    Date
  inviteeName?: string | null
}): { subject: string; htmlBody: string; textBody: string } {
  const { inviterName, roleName, inviteUrl, expiresAt, inviteeName } = params

  const subject = `You've been invited to join the Kinvox team`

  // Localized, unambiguous expiry stamp. Server TZ is UTC, so label it.
  const expiresLabel = `${expiresAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone:  'UTC',
  })} UTC`

  const greetingName = inviteeName?.trim() || 'there'

  // "<inviter> has invited you to join the Kinvox team as <role>." — single
  // conversational sentence; Kinvox is the inviting entity when no inviter name.
  const invitedSentence =
    `${inviterName ? `${inviterName} has` : 'Kinvox has'} invited you to join the Kinvox team${roleName ? ` as ${roleName}` : ''}.`

  // ── Plain text ──────────────────────────────────────────────────────────
  const textBody = [
    `Hi ${greetingName},`,
    '',
    invitedSentence,
    '',
    `To accept, please visit: ${inviteUrl}`,
    '',
    `This invitation expires on ${expiresLabel}.`,
    '',
    '— The Kinvox team',
  ].join('\n')

  // ── HTML (conversational shell) ──────────────────────────────────────────
  const greetSafe = escapeHtml(greetingName)
  const urlSafe   = escapeHtml(inviteUrl)
  const invitedSentenceHtml =
    `${inviterName ? `<strong>${escapeHtml(inviterName)}</strong> has` : '<strong>Kinvox</strong> has'} invited you to join the <strong>Kinvox</strong> team${roleName ? ` as ${escapeHtml(roleName)}` : ''}.`

  // Inline link uses the raw URL as its own display text so the visible text
  // matches the href — eliminates the display-text-≠-href phishing signal.
  const htmlInner = [
    `<p style="margin:0 0 12px;">Hi ${greetSafe},</p>`,
    `<p style="margin:0 0 12px;">${invitedSentenceHtml}</p>`,
    `<p style="margin:0 0 12px;">To accept, please visit: <a href="${urlSafe}">${urlSafe}</a></p>`,
    `<p style="margin:0 0 12px;">This invitation expires on ${escapeHtml(expiresLabel)}.</p>`,
    `<p style="margin:24px 0 0;">— The Kinvox team</p>`,
  ].join('\n')

  return { subject, htmlBody: wrapHtmlDocument(subject, htmlInner), textBody }
}
