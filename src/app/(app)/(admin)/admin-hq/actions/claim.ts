'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ServerClient } from 'postmark'
import { createClient } from '@/lib/supabase/server'
import { generateClaim } from '@/lib/claims'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOG = '[send-claim-invite]'

async function requireHqAdmin() {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')
}

function buildEmail(orgName: string, claimUrl: string): { text: string; html: string } {
  const text = [
    `You've been invited to claim ${orgName} on Kinvox.`,
    '',
    'Kinvox is the sales + support workspace your team will run day-to-day.',
    'Follow the link below to finish setup — it will take you through sign-up',
    'and hand ownership of the organization to your account.',
    '',
    'This link expires in 7 days:',
    claimUrl,
    '',
    'If you weren\'t expecting this invitation, you can safely ignore this email.',
    '',
    '— The Kinvox team',
  ].join('\n')

  // Deliberately inline-styled + single-column so Gmail/Outlook render
  // consistently. No external images — works offline / with images blocked.
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border:1px solid #1f2937;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 0 32px;">
              <div style="font-size:11px;letter-spacing:0.28em;font-weight:700;text-transform:uppercase;color:#34d399;">Kinvox</div>
              <h1 style="margin:22px 0 0 0;font-size:22px;line-height:1.3;font-weight:600;color:#ffffff;">
                You've been invited to claim <span style="color:#6ee7b7;">${escapeHtml(orgName)}</span>
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0 32px;font-size:14px;line-height:1.6;color:#9ca3af;">
              Kinvox is the sales + support workspace your team will run day-to-day. Follow the link below to finish sign-up and take ownership of your organization.
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <a href="${claimUrl}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">Claim ${escapeHtml(orgName)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 0 32px;font-size:12px;line-height:1.6;color:#6b7280;">
              This link expires in 7 days. If the button doesn't work, paste this URL into your browser:<br>
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9ca3af;word-break:break-all;">${claimUrl}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 28px 32px;font-size:12px;line-height:1.6;color:#4b5563;border-top:1px solid #1f2937;margin-top:24px;">
              If you weren't expecting this invitation, you can safely ignore this email.<br>
              — The Kinvox team
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendOrganizationClaimInvite(formData: FormData) {
  await requireHqAdmin()

  const orgId = String(formData.get('org_id') ?? '').trim()
  const email = String(formData.get('email')  ?? '').trim().toLowerCase()
  if (!orgId) redirect('/admin-hq/organizations')

  const redirectTo = (flag: string) =>
    redirect(`/admin-hq/organizations/${orgId}?${flag}`)

  if (!EMAIL_RE.test(email)) return redirectTo('claim_error=' + encodeURIComponent('Enter a valid email'))

  const result = await generateClaim(orgId, email)
  if (!result.ok) {
    return redirectTo('claim_error=' + encodeURIComponent(result.error.message))
  }

  const { claim_url, organization_name } = result.data
  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN
  if (!postmarkToken) {
    // Token persisted so we can still surface the link in the UI flash
    // even when email delivery is offline.
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — claim created but email not delivered. URL: ${claim_url}`)
    return redirectTo('claim_error=' + encodeURIComponent('Claim created but email delivery is offline — see server logs for the URL.'))
  }

  const { text, html } = buildEmail(organization_name, claim_url)

  try {
    const client = new ServerClient(postmarkToken)
    const sent = await client.sendEmail({
      From:     'Kinvox Support <support@kinvoxtech.com>',
      To:       email,
      Subject:  `Claim ${organization_name} on Kinvox`,
      TextBody: text,
      HtmlBody: html,
    })
    console.log(`${LOG} dispatched to=${email} postmark_id=${sent.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} Postmark send FAILED for ${email}: ${msg}`)
    return redirectTo('claim_error=' + encodeURIComponent('Email delivery failed — claim still valid. Retry or resend.'))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirectTo('claim_sent=' + encodeURIComponent(email))
}
