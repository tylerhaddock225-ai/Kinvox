// Team invite template (Workstream J).
//
// Renders the org-side "join our team" invitation email. Emits
// { subject, htmlBody, textBody } in the same shape as
// renderAppointmentAgentInvite / renderTicketConfirmationEmail. The dispatch
// site (settings/team/actions.ts → inviteMember) hands the result to
// sendOrgTransactionalEmail, which derives the From address (org-branded with
// Kinvox fallback) — so this template intentionally carries NO From branding.
//
// Visual: light-theme wrapper (shared appointment-template pattern) + the
// green CTA button styling borrowed from the HQ claim email.

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

// CTA button — green pill borrowed from hq/actions/claim.ts buildEmail so the
// two invite surfaces stay visually consistent.
function renderCtaButton(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">${escapeHtml(label)}</a>`
}

export function renderTeamInviteEmail(params: {
  orgName:     string
  inviterName: string | null
  roleName:    string | null
  inviteUrl:   string
  expiresAt:   Date
}): { subject: string; htmlBody: string; textBody: string } {
  const { orgName, inviterName, roleName, inviteUrl, expiresAt } = params

  const subject = `${orgName} invited you to join their team on Kinvox`

  // Localized, unambiguous expiry stamp. Server TZ is UTC, so label it.
  const expiresLabel = `${expiresAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone:  'UTC',
  })} UTC`

  const invitedLine = inviterName
    ? `${inviterName} invited you to join ${orgName} on Kinvox.`
    : `${orgName} invited you to join their team on Kinvox.`

  // ── Plain text ──────────────────────────────────────────────────────────
  const textLines: Array<string | null> = [
    "You've been invited.",
    '',
    invitedLine,
    roleName ? '' : null,
    roleName ? `Your role: ${roleName}` : null,
    '',
    'Accept the invitation using the link below:',
    inviteUrl,
    '',
    `This invitation expires ${expiresLabel}.`,
    '',
    '— The Kinvox team',
  ]
  const textBody = textLines.filter((l): l is string => l !== null).join('\n')

  // ── HTML ────────────────────────────────────────────────────────────────
  const orgSafe = escapeHtml(orgName)
  const invitedLineHtml = inviterName
    ? `<strong>${escapeHtml(inviterName)}</strong> invited you to join <strong>${orgSafe}</strong> on Kinvox.`
    : `<strong>${orgSafe}</strong> invited you to join their team on Kinvox.`

  const roleBlock = roleName
    ? `<p style="margin:16px 0 0 0;">Your role: <strong>${escapeHtml(roleName)}</strong></p>`
    : ''

  const htmlInner = [
    `<p style="font-size:18px;font-weight:600;margin:0 0 12px 0;">You've been invited</p>`,
    `<p style="margin:0;">${invitedLineHtml}</p>`,
    roleBlock,
    `<p style="margin:24px 0 0 0;">${renderCtaButton('Accept invitation', inviteUrl)}</p>`,
    `<p style="margin:20px 0 0 0;font-size:13px;color:#6b7280;">If the button doesn't work, paste this URL into your browser:<br><span style="word-break:break-all;color:#374151;">${escapeHtml(inviteUrl)}</span></p>`,
    `<p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">This invitation expires ${escapeHtml(expiresLabel)}.</p>`,
    `<p style="margin:24px 0 0 0;color:#6b7280;">— The Kinvox team</p>`,
  ].filter(Boolean).join('\n')

  return { subject, htmlBody: wrapHtmlDocument(subject, htmlInner), textBody }
}
