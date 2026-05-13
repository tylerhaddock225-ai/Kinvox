// Postmark inbound forwarding-address helper.
//
// Inbound for both channels (support/tickets and lead conversations) is
// routed through a Postmark Inbound Domain Forwarding stream
// (e.g. inbound-sand.kinvoxtech.com on sandbox, inbound.kinvoxtech.com on
// production). Postmark accepts mail addressed to <anything>@<our-domain>
// and surfaces the localpart as the routing tag. The DB stores only the
// <tag>; the full address is assembled here at display/use time.
//
// This module is server-only (it reads process.env.POSTMARK_INBOUND_DOMAIN,
// which is not exposed to the browser). Server components and server
// actions call this helper, then pass the constructed string down to client
// components for display.

export const POSTMARK_INBOUND_DOMAIN_ENV = 'POSTMARK_INBOUND_DOMAIN'

/**
 * Build the customer-facing inbound forwarding address for a tenant tag.
 *
 *   tag                     = "support-niko-s-storm-protection"
 *   POSTMARK_INBOUND_DOMAIN = "inbound-sand.kinvoxtech.com"
 *   →                         "support-niko-s-storm-protection@inbound-sand.kinvoxtech.com"
 *
 * Returns null when either the tag is null/empty or the env var is unset
 * or malformed (contains `@`, or empty after trim). Callers typically
 * display "— not assigned yet —" in those cases; the UI surface should not
 * invent a fake address.
 */
export function constructInboundEmailAddress(tag: string | null): string | null {
  const trimmedTag = tag?.trim() ?? ''
  if (!trimmedTag) return null

  const domain = process.env[POSTMARK_INBOUND_DOMAIN_ENV]?.trim() ?? ''
  if (!domain || domain.includes('@')) return null

  return `${trimmedTag}@${domain}`
}
