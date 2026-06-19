// Team invite template (Workstream J).
//
// Renders the org-side "join our team" invitation email. Emits
// { subject, htmlBody, textBody } in the same shape as
// renderAppointmentAgentInvite / renderTicketConfirmationEmail. The dispatch
// site (settings/team/actions.ts → inviteMember) hands the result to
// sendOrgTransactionalEmail, which derives the From address (org-branded with
// Kinvox fallback) — so this template intentionally carries NO From branding.
//
// Visual: deliberately mirrors renderConversationReply (reply.ts) — the same
// light wrapper, short conversational paragraphs, and an inline text link
// (no green CTA pill, no "You've been invited" heading, no standalone raw
// token URL). Aligning with the support-reply shape keeps invites out of the
// Gmail content-classifier penalty box that the promotional CTA layout drew.

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

export function renderTeamInviteEmail(params: {
  orgName:      string
  inviterName:  string | null
  roleName:     string | null
  inviteUrl:    string
  expiresAt:    Date
  inviteeName?: string | null
}): { subject: string; htmlBody: string; textBody: string } {
  const { orgName, inviterName, roleName, inviteUrl, expiresAt, inviteeName } = params

  const subject = `${orgName} invited you to join their team on Kinvox`

  // Localized, unambiguous expiry stamp. Server TZ is UTC, so label it.
  const expiresLabel = `${expiresAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone:  'UTC',
  })} UTC`

  // Greeting name: the invitee's name when known, else a neutral "there"
  // (mirrors renderConversationReply's resolveGreetingName fallback).
  const greetingName = inviteeName?.trim() || 'there'

  // "<inviter> has invited you to join <org> as <role> on Kinvox." — a single
  // conversational sentence rather than a heading + branded role block.
  const invitedSentence =
    `${inviterName ? `${inviterName} has` : `${orgName} has`} invited you to join ${orgName}${roleName ? ` as ${roleName}` : ''} on Kinvox.`

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
  const orgSafe   = escapeHtml(orgName)
  const greetSafe = escapeHtml(greetingName)
  const urlSafe   = escapeHtml(inviteUrl)
  const invitedSentenceHtml =
    `${inviterName ? `<strong>${escapeHtml(inviterName)}</strong> has` : `<strong>${orgSafe}</strong> has`} invited you to join <strong>${orgSafe}</strong>${roleName ? ` as ${escapeHtml(roleName)}` : ''} on Kinvox.`

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
