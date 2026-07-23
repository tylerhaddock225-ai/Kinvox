// Bracketed conversation-routing tags — the thread keys shared by the inbound
// webhooks (Postmark email + Twilio SMS). `[tk_X]` threads a reply back to a
// ticket; `[ld_X]` to a lead. Case-insensitive, matched anywhere in the subject
// (email) or body (SMS). No `/g` flag, so these are stateless and safe to share
// across call sites (a `/g` regex would carry lastIndex between .match() calls).

export const TICKET_TAG_RE = /\[(tk_[a-z0-9]+)\]/i
export const LEAD_TAG_RE   = /\[(ld_[a-z0-9]+)\]/i
