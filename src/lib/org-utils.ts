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
