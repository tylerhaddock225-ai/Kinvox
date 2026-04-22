// Short-lived token primitive shared by password-reset and
// organization-claim flows.
//
// Invariants:
//   - Raw token: 256 bits of entropy, rendered as 64-char hex so it
//     survives URL transport untouched.
//   - We never store the raw token. The DB column holds sha256(token),
//     so a DB leak alone can't be replayed.
//   - Callers are responsible for persisting the hash + expires_at
//     (and whatever single-use bookkeeping the feature needs:
//     used_at for reset, claimed_at for claim).

import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

const RAW_TOKEN_BYTES = 32

export type MintedToken = {
  raw:  string  // the thing that goes into the outbound URL
  hash: string  // the thing that goes into the DB
}

export function mintToken(): MintedToken {
  const raw = randomBytes(RAW_TOKEN_BYTES).toString('hex')
  return { raw, hash: hashToken(raw) }
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// Turns "7 days" / "60 minutes" into an expires_at timestamptz we can
// insert directly. Using ISO strings keeps PG happy without the caller
// needing to know about `now() + interval '…'`.
export function ttlFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

// Centralized constants so flows don't drift on TTL.
export const TTL = {
  PASSWORD_RESET:    60 * 60 * 1000,          // 1h
  ORGANIZATION_CLAIM: 7 * 24 * 60 * 60 * 1000, // 7d
} as const
