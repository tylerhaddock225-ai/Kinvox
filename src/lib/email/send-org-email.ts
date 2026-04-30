// Unified Postmark sender for Organization-attributed transactional email.
//
// One call shape, one error contract, one log format. Existing inline
// Postmark sites (tickets, appointments, claim invites, password reset,
// merchant alerts) still hand-roll their own ServerClient — those are
// scheduled for retrofit in a later maintenance pass; new code paths
// should use this helper.
//
// Pure: no DB reads, no side effects beyond the Postmark API call.
// Caller resolves and passes the `org` context object.

import { ServerClient } from 'postmark'

export type OrgEmailContext = {
  id:                                  string
  name:                                string
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
}

export type SendOrgEmailParams = {
  org:       OrgEmailContext
  to:        string
  subject:   string
  htmlBody:  string
  textBody:  string
  replyTo?:  string
  tag?:      string
}

export type SendOrgEmailResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

const KINVOX_FALLBACK_FROM = 'Kinvox <support@kinvoxtech.com>'

// Resolution rules mirror the inline call sites (tickets.ts, appointments.ts):
// confirmed verified_support_email → "<orgName> <verified_support_email>";
// otherwise the Kinvox shared mailbox so outbound never silently breaks.
function resolveFromAddress(org: OrgEmailContext): string {
  if (org.verified_support_email && org.verified_support_email_confirmed_at) {
    return `${org.name} <${org.verified_support_email}>`
  }
  return KINVOX_FALLBACK_FROM
}

export async function sendOrgTransactionalEmail(
  params: SendOrgEmailParams,
): Promise<SendOrgEmailResult> {
  const { org, to, subject, htmlBody, textBody, replyTo, tag } = params
  const LOG = '[send-org-email]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — org=${org.id} tag=${tag ?? '-'}`)
    return { ok: false, error: 'Postmark token not configured' }
  }

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail({
      From:     resolveFromAddress(org),
      To:       to,
      Subject:  subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      ReplyTo:  replyTo,
      Tag:      tag,
    })
    console.log(`${LOG} ok org=${org.id} tag=${tag ?? '-'} postmark_id=${result.MessageID}`)
    return { ok: true, messageId: result.MessageID }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${org.id} tag=${tag ?? '-'} error=${message}`)
    return { ok: false, error: message }
  }
}
