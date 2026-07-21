// Server-only lazy singleton for the Twilio REST client. The single point where
// the Kinvox app talks to the SMS provider — account credentials and client
// construction live here so the rest of the SMS rail stays provider-agnostic.
//
// Mirrors src/lib/ai/claude.ts's env-guard style: credentials are read at first
// use (not module load) and a missing var throws a clear Error the caller path
// serializes into a {ok:false} result.

import 'server-only'
import twilio, { type Twilio } from 'twilio'

let cached: Twilio | null = null

/**
 * Return the shared Twilio client, constructing it on first use.
 * @throws Error when TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is unset.
 */
export function getTwilioClient(): Twilio {
  if (cached) return cached
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set in environment variables.')
  }
  cached = twilio(accountSid, authToken)
  return cached
}
