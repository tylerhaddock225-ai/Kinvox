// Unified Postmark sender for Kinvox PLATFORM-attributed transactional email.
//
// The platform-sender parallel of sendOrgTransactionalEmail (see
// ./send-org-email). Identical call shape and error contract, but the From is
// the Kinvox platform sender — no org context, no org branding, no org inbound
// tag, no org threading. Use this for HQ-scoped mail (e.g. HQ user invitations)
// where there is no tenant organization to attribute the message to.
//
// Borrowed forward for Workstream J Stage 1; Workstream G owns retrofitting the
// existing inline platform sends (password reset, merchant alerts) onto this —
// no call sites are retrofit here.
//
// Pure: no DB reads, no side effects beyond the Postmark API call. Mirrors the
// ServerClient-forbidden discipline of send-org-email — callers never pass a
// ServerClient; the helper owns construction from POSTMARK_SERVER_TOKEN.

import { ServerClient } from 'postmark'
import type { EmailAttachment } from './send-org-email'

// Platform From address. Same verified Kinvox sender that send-org-email falls
// back to (KINVOX_FALLBACK_FROM), so it is a confirmed Postmark sender — not a
// stub. HQ/platform mail is always attributed here. If a dedicated no-reply
// platform domain is provisioned later, change this single constant.
const PLATFORM_FROM = 'Kinvox <support@kinvoxtech.com>'

export type SendPlatformEmailParams = {
  // `to` and `cc` accept either a single address or an array. Arrays are joined
  // with ", " before handing to Postmark (the SDK only takes a comma-separated
  // string). All array entries appear in the same RFC header.
  to:           string | string[]
  cc?:          string | string[]
  subject:      string
  htmlBody:     string
  textBody:     string
  replyTo?:     string
  tag?:         string
  // Arbitrary RFC-5322 headers forwarded to Postmark verbatim (e.g. threading).
  headers?:     Array<{ Name: string; Value: string }>
  attachments?: EmailAttachment[]
}

export type SendPlatformEmailResult =
  | { ok: true;  messageId: string }
  | { ok: false; error: string }

function joinAddresses(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  if (value.length === 0)        return undefined
  return value.join(', ')
}

export async function sendPlatformEmail(
  params: SendPlatformEmailParams,
): Promise<SendPlatformEmailResult> {
  const { to, cc, subject, htmlBody, textBody, replyTo, tag, headers, attachments } = params
  const LOG = '[send-platform-email]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — tag=${tag ?? '-'}`)
    return { ok: false, error: 'Postmark token not configured' }
  }

  const toJoined = joinAddresses(to)
  if (!toJoined) {
    console.error(`${LOG} empty To — tag=${tag ?? '-'}`)
    return { ok: false, error: 'Recipient list is empty' }
  }
  const ccJoined = joinAddresses(cc)
  const ccCount  = Array.isArray(cc) ? cc.length : (cc ? 1 : 0)
  const attCount = attachments?.length ?? 0

  // Same build-from-base-then-layer-optionals shape as send-org-email.
  const payload: Parameters<ServerClient['sendEmail']>[0] = {
    From:     PLATFORM_FROM,
    To:       toJoined,
    Subject:  subject,
    HtmlBody: htmlBody,
    TextBody: textBody,
  }
  if (ccJoined !== undefined) payload.Cc      = ccJoined
  if (replyTo  !== undefined) payload.ReplyTo = replyTo
  if (tag      !== undefined) payload.Tag     = tag
  if (headers  !== undefined) payload.Headers = headers
  if (attachments && attachments.length > 0) {
    payload.Attachments = attachments.map(a => ({
      Name:        a.name,
      Content:     a.content,
      ContentType: a.contentType,
      ContentID:   a.contentId ?? null,
    }))
  }

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail(payload)
    console.log(`${LOG} ok tag=${tag ?? '-'} cc=${ccCount} att=${attCount} postmark_id=${result.MessageID}`)
    return { ok: true, messageId: result.MessageID }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED tag=${tag ?? '-'} error=${message}`)
    return { ok: false, error: message }
  }
}
