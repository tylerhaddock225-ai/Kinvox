'use server'

// Public SMS opt-in confirm action (SMS Stage 2a). Unauthenticated — the visitor
// holds only a single-purpose token. Rate-limited per-token and per-IP, then
// delegated to confirmSmsOptIn (which records consent + nulls the token). No SMS
// is sent here; delivery is a later stage.

import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, bestEffortIp } from '@/lib/rate-limit'
import { confirmSmsOptIn, isOptInKind } from '@/lib/sms/opt-in'
import { formatPhoneDisplay } from '@/lib/phone'

export type OptInFormState =
  | { status: 'success'; phoneDisplay: string }
  | { status: 'error'; error: 'link_invalid' | 'phone_required' | 'rate_limited' | 'store_failed' | 'bad_request' }
  | null

export async function confirmOptInAction(
  _prev: OptInFormState,
  formData: FormData,
): Promise<OptInFormState> {
  const kind  = String(formData.get('kind')  ?? '')
  const token = String(formData.get('token') ?? '')
  const phone = String(formData.get('phone') ?? '')

  if (!isOptInKind(kind) || !token) return { status: 'error', error: 'bad_request' }

  // Rate limit per-token + per-IP. The token is single-use + high-entropy, so this
  // is defense-in-depth against hammering, not the primary guard: block only on an
  // explicit limit-exceeded (allowed === false); on an RPC error (allowed === null)
  // fail OPEN so a DB hiccup never denies a legitimate person their consent click.
  const admin = createAdminClient()
  const ip = await bestEffortIp()
  const [tokenCheck, ipCheck] = await Promise.all([
    checkRateLimit(admin, `sms_optin:${token}`, 60, 5),
    ip ? checkRateLimit(admin, `sms_optin_ip:${ip}`, 60, 20) : Promise.resolve({ allowed: true, count: 0 }),
  ])
  if (tokenCheck.allowed === false || ipCheck.allowed === false) {
    console.warn(`[sms-opt-in] confirm rate-limited kind=${kind} token_allowed=${tokenCheck.allowed} ip_allowed=${ipCheck.allowed}`)
    return { status: 'error', error: 'rate_limited' }
  }

  const result = await confirmSmsOptIn(kind, token, phone)
  if (!result.ok) return { status: 'error', error: result.error }

  return { status: 'success', phoneDisplay: formatPhoneDisplay(result.phoneE164) }
}
