'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export type ApplyState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 3
const bucket = new Map<string, { count: number; resetAt: number }>()

function rateLimit(key: string): boolean {
  const now = Date.now()
  const entry = bucket.get(key)
  if (!entry || entry.resetAt < now) {
    bucket.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count += 1
  return true
}

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

  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  if (!rateLimit(ip)) {
    return { ok: false, error: 'Too many submissions. Please try again in a minute.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('applications').insert({
    business_name: businessName,
    email,
    website,
    source_ip: ip === 'unknown' ? null : ip,
  })

  if (error) {
    return { ok: false, error: 'Something went wrong. Please try again shortly.' }
  }

  return { ok: true, message: 'Thanks — we received your application and will be in touch.' }
}
