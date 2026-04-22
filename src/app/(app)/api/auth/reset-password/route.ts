import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { ServerClient } from 'postmark'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[reset-password]'

const APP_URL           = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'
const RESET_BASE_URL    = `${APP_URL}/reset-password`
const TOKEN_TTL_MINUTES = 60

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown }
  try {
    body = await request.json() as { email?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  // We always respond 200 below to avoid leaking which addresses are registered.
  // Internal failures still log to the terminal so we can spot them.
  const supabase = createAdminClient()

  // listUsers doesn't support direct email filtering on every Supabase version,
  // so page through and match. With a small user base this is fine; replace with
  // a getUserByEmail RPC if it grows.
  let userId: string | null = null
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === email)
    if (match) userId = match.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} user lookup failed for ${email}: ${msg}`)
    // Fall through and return generic 200 so the response is uniform.
  }

  if (!userId) {
    console.warn(`${LOG} reset requested for unknown email ${email}`)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  // Generate token: 32 random bytes → 64 hex chars. The plaintext travels in
  // the email link; we only persist its SHA-256 hash.
  const token     = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000).toISOString()

  const { error: insErr } = await supabase.from('password_reset_tokens').insert({
    user_id:    userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  })
  if (insErr) {
    console.error(`${LOG} failed to persist token for user=${userId}: ${insErr.message}`)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const link = `${RESET_BASE_URL}?token=${encodeURIComponent(token)}`

  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN
  if (!postmarkToken) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — cannot deliver reset email to ${email}. Link: ${link}`)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const text = [
    'You (or someone using your address) requested a password reset for your Kinvox account.',
    '',
    'Use this link to choose a new password — it expires in 60 minutes:',
    link,
    '',
    'If you didn\'t request this, you can safely ignore this email.',
    '',
    '— The Kinvox team',
  ].join('\n')

  try {
    const client = new ServerClient(postmarkToken)
    const result = await client.sendEmail({
      From:     'Kinvox Support <support@kinvoxtech.com>',
      To:       email,
      Subject:  'Reset your Kinvox password',
      TextBody: text,
    })
    console.log(`[ticket-email] dispatched password-reset to=${email} postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} Postmark send FAILED for ${email}: ${msg}`)
    // Still 200 — the token row exists and the user can re-request.
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

// PATCH /api/auth/reset-password — confirm: validate token + set new password.
export async function PATCH(request: NextRequest) {
  let body: { token?: unknown; password?: unknown }
  try {
    body = await request.json() as { token?: unknown; password?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token    = typeof body.token === 'string' ? body.token : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!token) return NextResponse.json({ error: 'Missing reset token' }, { status: 400 })

  const complexity = validatePassword(password)
  if (complexity) return NextResponse.json({ error: complexity }, { status: 400 })

  const supabase = createAdminClient()
  const tokenHash = hashToken(token)

  const { data: row, error: lookupErr } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (lookupErr) {
    console.error(`${LOG} token lookup failed: ${lookupErr.message}`)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
  if (row.used_at) return NextResponse.json({ error: 'This reset link has already been used' }, { status: 400 })
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This reset link has expired' }, { status: 400 })
  }

  const { error: updErr } = await supabase.auth.admin.updateUserById(row.user_id, { password })
  if (updErr) {
    console.error(`${LOG} password update failed for user=${row.user_id}: ${updErr.message}`)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // Burn the token + revoke any other outstanding tokens for this user.
  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('user_id', row.user_id)
    .is('used_at', null)

  console.log(`${LOG} password reset successful for user=${row.user_id}`)
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

function validatePassword(password: string): string | null {
  if (password.length < 8)            return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(password))        return 'Password must contain at least 1 uppercase letter.'
  if (!/[a-z]/.test(password))        return 'Password must contain at least 1 lowercase letter.'
  if (!/[0-9]/.test(password))        return 'Password must contain at least 1 number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least 1 symbol (e.g. !@#$).'
  return null
}
