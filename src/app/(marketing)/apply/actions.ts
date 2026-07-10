'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, bestEffortIp, type RateLimitResult } from '@/lib/rate-limit'

export type ApplyState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withProto)
    return u.toString()
  } catch {
    return null
  }
}

export async function submitApplication(
  _prev: ApplyState,
  formData: FormData
): Promise<ApplyState> {
  const businessName = String(formData.get('business_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const websiteRaw = String(formData.get('website') ?? '')

  if (!businessName || businessName.length > 200) {
    return { ok: false, error: 'Please provide a valid business name.' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, error: 'Please provide a valid email address.' }
  }
  const website = normalizeWebsite(websiteRaw)
  if (!website) {
    return { ok: false, error: 'Please provide a valid website URL.' }
  }

  const admin = createAdminClient()

  // SEC-M5-2: DB-backed limiter (replaces the old in-memory Map, which was
  // per-serverless-instance and reset on every cold start — ineffective). IP is
  // best-effort/spoofable, so the per-IP cap is paired with a global ceiling
  // that still bites a spoofed-IP flood. FAIL-OPEN: a single low-severity insert
  // with no email — only an explicit `allowed === false` blocks; an RPC error
  // lets the insert through with a logged warning.
  const ip = await bestEffortIp()
  const [ipCheck, globalCheck] = await Promise.all([
    ip
      ? checkRateLimit(admin, `apply_ip:${ip}`, 60, 3)
      : Promise.resolve<RateLimitResult>({ allowed: true, count: 0 }),
    checkRateLimit(admin, 'apply_global', 60, 30),
  ])
  if (ipCheck.allowed === false || globalCheck.allowed === false) {
    return { ok: false, error: 'Too many submissions. Please try again in a minute.' }
  }
  if (ipCheck.allowed === null || globalCheck.allowed === null) {
    console.warn(
      `[apply] rate-limit RPC unavailable — allowing submission (fail-open). ip_err=${ipCheck.error ?? ''} global_err=${globalCheck.error ?? ''}`,
    )
  }

  const { error } = await admin.from('applications').insert({
    business_name: businessName,
    email,
    website,
    source_ip: ip,
  })

  if (error) {
    return { ok: false, error: 'Something went wrong. Please try again shortly.' }
  }

  return { ok: true, message: 'Thanks — we received your application and will be in touch.' }
}
