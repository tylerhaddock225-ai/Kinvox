// Phone-number normalization for the SMS rail.
//
// The email rail never needed phone canonicalization; the SMS rail does, because
// inbound routing and provider APIs require strict E.164 (+14055551234). This is
// the single normalization layer — before it, phone columns held whatever the
// user typed. Write paths wire `normalizeToE164` in FAIL-OPEN: a number that
// won't parse is stored raw rather than blocking the write (a bad phone must
// never lose a lead or customer).

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/**
 * Normalize arbitrary user phone input to strict E.164 (e.g. '+14055551234'),
 * or null if it can't be parsed into a valid number.
 *
 * @param input          Raw phone string as typed (any format, or empty).
 * @param defaultCountry Region assumed for numbers without a country code.
 * @returns E.164 string, or null when the input is empty/unparseable/invalid.
 */
export function normalizeToE164(input: string, defaultCountry: CountryCode = 'US'): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  try {
    const parsed = parsePhoneNumberFromString(trimmed, defaultCountry)
    if (parsed && parsed.isValid()) return parsed.number // canonical E.164
    return null
  } catch {
    return null
  }
}

/**
 * Pretty national format for UI display (e.g. '(405) 555-1234'). Falls back to
 * the raw input when it can't be parsed, so a stored raw value still renders.
 *
 * @param e164 A phone string, ideally E.164 but tolerant of anything.
 * @returns National-format string, or the input unchanged on failure.
 */
export function formatPhoneDisplay(e164: string): string {
  if (!e164) return e164
  try {
    const parsed = parsePhoneNumberFromString(e164)
    if (parsed) return parsed.formatNational()
    return e164
  } catch {
    return e164
  }
}
