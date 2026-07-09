import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

// SEC-M5-2: shared server-side rate-limit helper. The ONLY limiter in the app —
// callers must never re-implement bucket logic (Commandment #15). Backed by the
// atomic public.check_rate_limit(text,int,int) RPC (SECURITY DEFINER, service_role
// EXECUTE only, SEC-M5-1). Must be called with an ADMIN (service-role) Supabase
// client — anon/authenticated cannot EXECUTE the RPC.

export type RateLimitResult = {
  // true  = under the limit for this window (post-increment count <= max)
  // false = limit exceeded
  // null  = the RPC errored/threw — decision UNKNOWN. The helper deliberately
  //         does NOT pick fail-open vs fail-closed; each CALLER decides based on
  //         this sentinel (fail-closed: require === true; fail-open: block only
  //         on === false).
  allowed: boolean | null
  count:   number       // post-increment count for the current window (0 when unknown)
  error?:  string
}

/**
 * Atomic check-and-increment against the current fixed window for `bucketKey`.
 * NEVER throws — an RPC/transport failure surfaces as { allowed: null } so the
 * caller owns the fail-open/fail-closed decision.
 */
export async function checkRateLimit(
  admin: SupabaseClient,
  bucketKey: string,
  windowSeconds: number,
  max: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key:            bucketKey,
      p_window_seconds: windowSeconds,
      p_max:            max,
    })
    if (error) {
      return { allowed: null, count: 0, error: error.message }
    }
    // check_rate_limit RETURNS TABLE(allowed boolean, current_count int) — over
    // PostgREST that is an array of rows; the decision is the first (only) row.
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row.allowed !== 'boolean') {
      return { allowed: null, count: 0, error: 'unexpected check_rate_limit response shape' }
    }
    return { allowed: row.allowed, count: typeof row.current_count === 'number' ? row.current_count : 0 }
  } catch (err) {
    return { allowed: null, count: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Best-effort client IP from a Headers object (first X-Forwarded-For hop).
 *
 * SPOOFABLE: behind Vercel the client can set X-Forwarded-For to anything, so
 * this is NOT a security boundary — it is a SUPPLEMENTARY signal layered on top
 * of server-resolved keys (slug, email). Returns null when no forwarded header
 * is present so callers can SKIP a shared "unknown" bucket rather than collapse
 * all header-less traffic into one counter (which would false-positive).
 */
export function ipFromHeaders(h: Headers): string | null {
  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = h.get('x-real-ip')?.trim()
  return real || null
}

/**
 * Best-effort client IP inside a Server Action / RSC via next/headers.
 * Same spoofability caveat as ipFromHeaders. Route Handlers should prefer
 * ipFromHeaders(request.headers) instead of this.
 */
export async function bestEffortIp(): Promise<string | null> {
  const h = await headers()
  return ipFromHeaders(h)
}
