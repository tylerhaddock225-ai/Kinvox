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
  // `to` and `cc` accept either a single address or an array. Arrays are
  // joined with ", " before handing to Postmark (the underlying SDK only
  // takes a comma-separated string). All array entries appear in the same
  // RFC header, so multi-To recipients see each other on the To: line.
  to:                  string | string[]
  cc?:                 string | string[]
  subject:             string
  htmlBody:            string
  textBody:            string
  replyTo?:            string
  tag?:                string
  fromAddressSource?:  FromAddressSource
  // Arbitrary RFC-5322 headers forwarded to Postmark verbatim. Used by
  // outbound callers to wire In-Reply-To / References for client-side
  // threading. Omit when not threading.
  headers?:            Array<{ Name: string; Value: string }>
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

function joinAddresses(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (value.length === 0)        return undefined
  return value.join(', ')
}

export async function sendOrgTransactionalEmail(
  params: SendOrgEmailParams,
): Promise<SendOrgEmailResult> {
  const { org, to, cc, subject, htmlBody, textBody, replyTo, tag, fromAddressSource, headers } = params
  const source = fromAddressSource ?? 'support'
  const LOG = '[send-org-email]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — org=${org.id} tag=${tag ?? '-'} source=${source}`)
    return { ok: false, error: 'Postmark token not configured' }
  }

  const toJoined = joinAddresses(to)
  if (!toJoined) {
    console.error(`${LOG} empty To — org=${org.id} tag=${tag ?? '-'} source=${source}`)
    return { ok: false, error: 'Recipient list is empty' }
  }
  const ccJoined = joinAddresses(cc)
  const ccCount  = Array.isArray(cc) ? cc.length : (cc ? 1 : 0)

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail({
      From:     resolveFromAddress(org, source),
      To:       toJoined,
      Cc:       ccJoined,
      Subject:  subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      ReplyTo:  replyTo,
      Tag:      tag,
      Headers:  headers,
    })
    console.log(`${LOG} ok org=${org.id} tag=${tag ?? '-'} source=${source} cc=${ccCount} postmark_id=${result.MessageID}`)
    return { ok: true, messageId: result.MessageID }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${org.id} tag=${tag ?? '-'} source=${source} error=${message}`)
    return { ok: false, error: message }
  }
}
