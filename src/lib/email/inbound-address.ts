// Postmark plus-addressed inbound mail helper.
//
// Inbound for both channels (support/tickets and lead conversations) is
// currently routed through the Postmark server's native inbound mailbox
// using plus-addressing — the local part is the server's inbound hash, the
// `+<tag>` portion identifies the tenant. The DB stores only the <tag>;
// the full address is assembled here.
//
// This module is server-only (it reads process.env.POSTMARK_INBOUND_ADDRESS,
// which is not exposed to the browser). Server components and server
// actions call this helper, then pass the constructed string down to client
// components for display.

export const POSTMARK_INBOUND_ADDRESS_ENV = 'POSTMARK_INBOUND_ADDRESS'

/**
 * Build the customer-facing inbound forwarding address for a tenant tag.
 *
 *   tag                      = "niko-s-storm-protection-efc3"
 *   POSTMARK_INBOUND_ADDRESS = "661a3559efa925b27b162bd566513508@inbound.postmarkapp.com"
 *   →                          "661a3559efa925b27b162bd566513508+niko-s-storm-protection-efc3@inbound.postmarkapp.com"
 *
 * Returns null when either the tag is null/empty or the env var is unset
 * or malformed (no `@`). Callers typically display "— not assigned yet —"
 * in those cases; the UI surface should not invent a fake address.
 */
export function constructInboundEmailAddress(tag: string | null): string | null {
  const trimmed = tag?.trim() ?? ''
  if (!trimmed) return null

  const base = process.env[POSTMARK_INBOUND_ADDRESS_ENV]?.trim() ?? ''
  if (!base) return null

  const at = base.indexOf('@')
  if (at <= 0 || at === base.length - 1) return null

  const local  = base.slice(0, at)
  const domain = base.slice(at + 1)
  return `${local}+${trimmed}@${domain}`
}
