// Manifest #8 — no PII reaches the AI engine.
//
// HONEST CONTRACT: the caller-supplied `knownIdentifiers` list is the real
// guard. Callers MUST pass every identifier they hold for the subject of the
// text — the lead/customer name, email, phone, and any social handle — because
// only the caller knows which strings are personal data. The regex pass below
// is a BACKSTOP that catches obvious email/phone/URL shapes the caller forgot;
// it is NOT a substitute for passing identifiers and will miss names, addresses,
// order numbers, and anything that doesn't match a fixed pattern. Redaction
// deliberately errs toward over-removal — a stray `[REDACTED]` is cheap; leaking
// a customer's name to the model is not.

// Emails, then URLs, then phones. Order matters: URLs are redacted before phones
// so digits inside a URL path don't get half-eaten by the phone pass.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const URL_RE   = /\b(?:https?:\/\/|www\.)[^\s]+/gi
// A run of 7+ digits allowing spaces, dots, dashes, parens and a leading +.
const PHONE_RE = /\+?\d(?:[\d\s().-]{5,}\d)/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip personal data out of free text before it is sent to Claude.
 *
 * @param text             The raw text (a support message, review body, etc.).
 * @param knownIdentifiers Identifiers the caller holds for the subject (name,
 *                         email, phone, handle). Each non-empty entry is
 *                         replaced with `[REDACTED]` wherever it appears,
 *                         case-insensitively. THIS is the primary guard.
 * @returns The text with known identifiers and email/phone/URL shapes replaced
 *          by placeholders.
 */
export function redactPii(text: string, knownIdentifiers: string[] = []): string {
  if (!text) return text

  let out = text

  // 1) Primary guard: caller-supplied identifiers. Longest first so a full name
  //    ("Jane Doe") is removed before its parts would match separately.
  const identifiers = Array.from(
    new Set(knownIdentifiers.map((s) => (s ?? '').trim()).filter((s) => s.length > 1)),
  ).sort((a, b) => b.length - a.length)

  for (const id of identifiers) {
    out = out.replace(new RegExp(escapeRegExp(id), 'gi'), '[REDACTED]')
  }

  // 2) Backstop: obvious contact-info shapes the caller may have missed.
  out = out.replace(EMAIL_RE, '[EMAIL]')
  out = out.replace(URL_RE, '[URL]')
  out = out.replace(PHONE_RE, '[PHONE]')

  return out
}
