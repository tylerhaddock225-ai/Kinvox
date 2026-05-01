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
//
// Channel split: as of the lead-email-split migration, the Organization
// has TWO independent verified email channels:
//   - verified_support_email (support tickets, customer service replies)
//   - verified_lead_email    (lead-magnet confirmations, new-lead alerts)
// Callers pass `fromAddressSource` to pick which channel resolves the
// From address. Defaults to 'support' so existing call sites keep their
// behavior without code changes.

import { ServerClient } from 'postmark'

export type OrgEmailContext = {
  id:                                  string
  name:                                string
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
  // Optional so existing callers that only pull the support pair keep
  // compiling; for `fromAddressSource: 'lead'` the caller MUST include
  // these fields or the helper falls through to the Kinvox fallback.
  verified_lead_email?:                string | null
  verified_lead_email_confirmed_at?:   string | null
}

export type FromAddressSource = 'support' | 'lead'

export type SendOrgEmailParams = {
  org:                 OrgEmailContext
  to:                  string
  subject:             string
  htmlBody:            string
  textBody:            string
  replyTo?:            string
  tag?:                string
  fromAddressSource?:  FromAddressSource
}

export type SendOrgEmailResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

const KINVOX_FALLBACK_FROM = 'Kinvox <support@kinvoxtech.com>'

// Resolution rules (per channel):
//   support → verified_support_email + verified_support_email_confirmed_at
//   lead    → verified_lead_email    + verified_lead_email_confirmed_at
// In both cases: confirmed pair present → "<orgName> <email>"; otherwise
// the Kinvox shared mailbox so outbound never silently breaks.
function resolveFromAddress(org: OrgEmailContext, source: FromAddressSource): string {
  if (source === 'lead') {
    if (org.verified_lead_email && org.verified_lead_email_confirmed_at) {
      return `${org.name} <${org.verified_lead_email}>`
    }
    return KINVOX_FALLBACK_FROM
  }
  if (org.verified_support_email && org.verified_support_email_confirmed_at) {
    return `${org.name} <${org.verified_support_email}>`
  }
  return KINVOX_FALLBACK_FROM
}

export async function sendOrgTransactionalEmail(
  params: SendOrgEmailParams,
): Promise<SendOrgEmailResult> {
  const { org, to, subject, htmlBody, textBody, replyTo, tag, fromAddressSource } = params
  const source = fromAddressSource ?? 'support'
  const LOG = '[send-org-email]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — org=${org.id} tag=${tag ?? '-'} source=${source}`)
    return { ok: false, error: 'Postmark token not configured' }
  }

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail({
      From:     resolveFromAddress(org, source),
      To:       to,
      Subject:  subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      ReplyTo:  replyTo,
      Tag:      tag,
    })
    console.log(`${LOG} ok org=${org.id} tag=${tag ?? '-'} source=${source} postmark_id=${result.MessageID}`)
    return { ok: true, messageId: result.MessageID }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${org.id} tag=${tag ?? '-'} source=${source} error=${message}`)
    return { ok: false, error: message }
  }
}
