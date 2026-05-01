const HASH_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no 0/o/1/l — friendlier when typed

function slugifyOrgName(name: string): string {
  const base = (name ?? '')
    .toLowerCase()
    // strip accents — NFKD then drop combining marks (U+0300–U+036F)
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')                          // non-alnum → dash
    .replace(/^-+|-+$/g, '')                              // trim dashes
    .slice(0, 32)                                         // keep local-part short
  return base || 'org'
}

function shortHash(length = 4): string {
  let out = ''
  // Use crypto for unbiased picks; fall back to Math.random in environments without it.
  const bytes = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(length))
    : Uint8Array.from({ length }, () => Math.floor(Math.random() * 256))
  for (let i = 0; i < length; i++) {
    out += HASH_ALPHABET[bytes[i] % HASH_ALPHABET.length]
  }
  return out
}

/**
 * Build a per-tenant tag for Postmark plus-addressing, e.g.
 *   "Anchor Support" -> "anchor-support-8f2j".
 *
 * The trailing 4-char hash makes collisions vanishingly unlikely while
 * keeping the tag short enough for users to read at a glance. Callers
 * should still rely on the unique index on
 * organizations.inbound_email_tag (and ..._lead_email_tag) and retry on
 * conflict.
 *
 * The full inbound address is assembled by constructInboundEmailAddress
 * in lib/email/inbound-address.ts from this tag plus the
 * POSTMARK_INBOUND_ADDRESS env var.
 */
export function generateInboundEmailTag(orgName: string): string {
  return `${slugifyOrgName(orgName)}-${shortHash()}`
}
