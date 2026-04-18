// Inbound mail addresses live on this subdomain. The MX records on
// inbound.kinvoxtech.com point at the email provider's parse webhook,
// which forwards to /api/webhooks/inbound-email.
export const INBOUND_EMAIL_DOMAIN = 'inbound.kinvoxtech.com'

const HASH_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // no 0/o/1/l — friendlier when typed

function slugifyOrgName(name: string): string {
  const base = (name ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')   // strip accents
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
 * Build a customer-facing inbound forwarding address from an org name, e.g.
 *   "Anchor Support" → "anchor-support-8f2j@inbound.kinvoxtech.com".
 *
 * The trailing 4-char hash makes collisions vanishingly unlikely while
 * keeping the address short enough for users to type into a forwarding rule.
 * Callers should still rely on the unique index on
 * `organizations.inbound_email_address` and retry on conflict.
 */
export function generateInboundEmail(orgName: string): string {
  const slug = slugifyOrgName(orgName)
  return `${slug}-${shortHash()}@${INBOUND_EMAIL_DOMAIN}`
}
