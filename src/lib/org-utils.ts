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
 * Build a per-tenant tag for the inbound forwarding address. Stored on
 * organizations.inbound_email_tag (support) or .inbound_lead_email_tag
 * (lead); assembled into the full plus-addressed email at display time
 * by constructInboundEmailAddress.
 *
 * Format: `<channel>-<orgSlug>` (e.g. "support-niko-s-storm-protection").
 * Uniqueness inherits from organizations_slug_key UNIQUE (slug); the
 * partial unique indexes on the two tag columns remain as defense-in-depth.
 *
 * Stickiness invariant: once minted, the tag must NEVER be overwritten,
 * even if the org renames or its slug changes. Customers may have
 * configured forwarding rules pointing at the original address, and the
 * inbound webhook routes by exact MailboxHash equality with the stored
 * tag. organizations.slug is RPC-only at creation today so drift is
 * theoretical, but the invariant is documented for the day slug edits
 * become a thing.
 */
export function buildInboundEmailTag(channel: 'support' | 'lead', orgSlug: string): string {
  return `${channel}-${orgSlug}`
}

// DEPRECATED: replaced by buildInboundEmailTag. Kept temporarily for reference.
export function generateInboundEmailTag(orgName: string): string {
  return `${slugifyOrgName(orgName)}-${shortHash()}`
}
