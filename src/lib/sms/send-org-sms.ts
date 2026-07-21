// Org-attributed outbound SMS — the SMS analog of sendOrgTransactionalEmail.
//
// PURE send helper: no DB reads/writes, never throws. Returns a typed result
// ({ok:true, providerMessageId} | {ok:false, error}); the caller persists the
// message row and reconciles the result, exactly like the email helper. Twilio
// errors are caught and serialized into the {ok:false} branch.
//
// From-number resolution is per-rail, mirroring the email rail's two verified
// channels (verified_support_email / verified_lead_email): support → the org's
// sms_support_number, lead → sms_lead_number. An org with no number for the
// requested rail returns {ok:false, error:'no_sms_number'} WITHOUT calling Twilio.
//
// No delivery/status callbacks this stage — those arrive with the inbound rail.

import 'server-only'
import { getTwilioClient } from '@/lib/sms/client'
import { normalizeToE164 } from '@/lib/phone'

// Twilio's hard cap for a single message body (concatenated segments).
const MAX_SMS_BODY = 1600

export type OrgSmsContext = {
  id:                  string
  sms_support_number:  string | null
  sms_lead_number?:    string | null
}

export type SendOrgSmsParams = {
  org:  OrgSmsContext
  rail: 'support' | 'lead'
  to:   string
  body: string
}

export type SendOrgSmsResult =
  | { ok: true;  providerMessageId: string }
  | { ok: false; error: string }

export async function sendOrgSms(params: SendOrgSmsParams): Promise<SendOrgSmsResult> {
  const { org, rail, to, body } = params
  const LOG = '[send-org-sms]'

  // From: the org's per-rail sender number. No number → don't touch Twilio.
  const from = rail === 'support' ? org.sms_support_number : (org.sms_lead_number ?? null)
  if (!from) {
    console.error(`${LOG} no ${rail} number configured — org=${org.id}`)
    return { ok: false, error: 'no_sms_number' }
  }

  // To: must already be E.164; normalize defensively so a stray format can't
  // reach the provider. Unparseable → refuse without calling Twilio.
  const normalizedTo = normalizeToE164(to)
  if (!normalizedTo) {
    console.error(`${LOG} invalid recipient phone — org=${org.id} rail=${rail}`)
    return { ok: false, error: 'invalid_phone' }
  }

  // Body: trim + hard-cap at Twilio's limit (truncate, don't reject).
  let text = (body ?? '').trim()
  if (text.length > MAX_SMS_BODY) {
    console.warn(`${LOG} body truncated ${text.length}→${MAX_SMS_BODY} — org=${org.id} rail=${rail}`)
    text = text.slice(0, MAX_SMS_BODY)
  }

  try {
    const client = getTwilioClient()
    const message = await client.messages.create({ from, to: normalizedTo, body: text })
    console.log(`${LOG} ok org=${org.id} rail=${rail} sid=${message.sid}`)
    return { ok: true, providerMessageId: message.sid }
  } catch (err) {
    // Serialize robustly — a non-Error throw (Twilio RestException, plain object)
    // stringifies to "[object Object]" and hides the cause (matches the email +
    // draft-reply error-serialization style).
    const detail = err instanceof Error
      ? `${err.name}: ${err.message}${(err as { code?: number }).code ? ` (code ${(err as { code?: number }).code})` : ''}`
      : (() => { try { return JSON.stringify(err) } catch { return String(err) } })()
    console.error(`${LOG} FAILED org=${org.id} rail=${rail} error=${detail}`)
    return { ok: false, error: detail }
  }
}
