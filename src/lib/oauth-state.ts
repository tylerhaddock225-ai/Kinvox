// Signed-state helpers for the social OAuth handshake.
//
// state format:    base64url(`${orgId}|${expiresAt}|${nonce}`) + '.' + hex(hmac)
// hmac:            HMAC-SHA256(payload, OAUTH_STATE_SECRET)
//
// Defends two things:
//   1. Tampering — the signature lets the callback trust the orgId that
//      came back through Reddit (the URL itself is untrusted, per the
//      Zero-Inference rule).
//   2. CSRF / state injection — the nonce is also dropped in an HttpOnly
//      cookie at /login. The callback verifies the state's nonce matches
//      the cookie, so an attacker who phishes a victim into clicking a
//      forged callback URL still can't bind their account because the
//      victim's browser doesn't carry the matching nonce.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const OAUTH_STATE_COOKIE = 'kinvox_oauth_state'
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export type SignedState = { orgId: string; expiresAt: number; nonce: string }

function getSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be set and at least 32 chars')
  }
  return secret
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url')
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

export function createSignedState(orgId: string): { state: string; nonce: string; expiresAt: number } {
  const expiresAt = Date.now() + OAUTH_STATE_TTL_MS
  const nonce     = randomBytes(24).toString('base64url')
  const payload   = `${orgId}|${expiresAt}|${nonce}`
  const sig       = createHmac('sha256', getSecret()).update(payload).digest('hex')
  return { state: `${b64urlEncode(payload)}.${sig}`, nonce, expiresAt }
}

export function verifySignedState(state: string, expectedNonce: string | undefined): SignedState | null {
  if (!state || typeof state !== 'string') return null
  const dot = state.lastIndexOf('.')
  if (dot < 0) return null

  const payloadB64 = state.slice(0, dot)
  const sigHex     = state.slice(dot + 1)

  let payload: string
  try { payload = b64urlDecode(payloadB64) } catch { return null }

  const expected = createHmac('sha256', getSecret()).update(payload).digest('hex')
  // timingSafeEqual requires equal-length buffers — bail if the lengths
  // disagree, since that's a guaranteed mismatch and a length-leak risk.
  if (expected.length !== sigHex.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigHex, 'hex'))) return null
  } catch {
    return null
  }

  const [orgId, expRaw, nonce] = payload.split('|')
  const expiresAt = Number(expRaw)
  if (!orgId || !nonce || !Number.isFinite(expiresAt)) return null
  if (Date.now() > expiresAt) return null

  // Cookie nonce must match — defends against state injection.
  if (!expectedNonce || expectedNonce.length !== nonce.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expectedNonce), Buffer.from(nonce))) return null
  } catch {
    return null
  }

  return { orgId, expiresAt, nonce }
}
