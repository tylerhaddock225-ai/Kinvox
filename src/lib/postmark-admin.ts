// Postmark Account API helpers. NEVER import this from client components —
// `POSTMARK_ACCOUNT_TOKEN` is a server-only secret that controls the entire
// Postmark account (sender signatures, servers, domains).

import { AccountClient } from 'postmark'

// Narrow shape that's structurally compatible with both Postmark's
// Signature (list result) and SignatureDetails (single result), so callers
// don't have to care which surface produced the row.
export type SenderSignature = {
  ID:           number
  EmailAddress: string
  Confirmed:    boolean
}

// Postmark API error code for "this sender signature already exists"
// (returned when createSenderSignature is called with an email that's
// already registered against the account).
const ERR_SIGNATURE_EXISTS = 504

function getAccountClient(): AccountClient {
  const token = process.env.POSTMARK_ACCOUNT_TOKEN
  if (!token) {
    throw new Error('POSTMARK_ACCOUNT_TOKEN is not set in environment variables.')
  }
  return new AccountClient(token)
}

/**
 * Register a new Sender Signature with Postmark and trigger the verification
 * email to the supplied address. The customer must click the link in that
 * email before Postmark will accept it as a `From` address.
 *
 * Idempotent on duplicate: if Postmark replies with ErrorCode 504 ("signature
 * already exists"), we transparently look up the existing signature and
 * return it as if creation had succeeded. The caller can read `Confirmed`
 * and decide whether to flip a confirmed_at timestamp.
 *
 * Any other Postmark error continues to throw.
 */
export async function createSenderSignature(
  email: string,
  name: string,
): Promise<SenderSignature> {
  if (!email?.trim() || !name?.trim()) {
    throw new Error('createSenderSignature: email and name are required')
  }

  const client = getAccountClient()

  try {
    const signature = await client.createSenderSignature({
      Name:      name.trim(),
      FromEmail: email.trim(),
    })
    console.log(`[postmark-admin] sender signature created id=${signature.ID} email=${signature.EmailAddress} confirmed=${signature.Confirmed}`)
    return {
      ID:           signature.ID,
      EmailAddress: signature.EmailAddress,
      Confirmed:    signature.Confirmed,
    }
  } catch (err) {
    const code = (err as { code?: number })?.code
    if (code === ERR_SIGNATURE_EXISTS) {
      // Recover gracefully: Postmark already has this signature. Look it up
      // so the caller can decide whether to mark the org confirmed (if the
      // existing signature is already verified) or just nudge the user to
      // click the verification link again.
      console.warn(`[postmark-admin] signature already exists for ${email} — falling back to lookup`)
      const existing = await getSenderSignatureByEmail(email.trim())
      if (existing) {
        console.log(`[postmark-admin] sender signature recovered id=${existing.ID} email=${existing.EmailAddress} confirmed=${existing.Confirmed}`)
        return existing
      }
      // Postmark said it exists but we can't see it on this token. Surface
      // the original error so the caller knows recovery failed.
      console.error(`[postmark-admin] signature reported as duplicate but lookup returned null for ${email}`)
    }
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[postmark-admin] FAILED to create sender signature for ${email}: ${msg}`)
    throw err
  }
}

/**
 * Look up a sender signature by email address. Postmark's Account API does
 * not expose a "find by email" endpoint, so we list and filter in memory.
 * The account is small enough that one page (count=500) covers everything;
 * upgrade to true pagination if the signature count ever approaches that.
 *
 * Returns the matching signature or null. Throws on Postmark API errors.
 */
export async function getSenderSignatureByEmail(
  email: string,
): Promise<SenderSignature | null> {
  if (!email?.trim()) {
    throw new Error('getSenderSignatureByEmail: email is required')
  }

  const client = getAccountClient()
  const target = email.trim().toLowerCase()

  try {
    const result = await client.getSenderSignatures({ count: 500, offset: 0 })
    const list   = result.SenderSignatures ?? []
    const match  = list.find((s) => s.EmailAddress?.toLowerCase() === target)
    if (!match) {
      console.log(`[postmark-admin] sender signature lookup miss email=${email} total=${list.length}`)
      return null
    }
    console.log(`[postmark-admin] sender signature lookup hit id=${match.ID} email=${match.EmailAddress} confirmed=${match.Confirmed}`)
    return {
      ID:           match.ID,
      EmailAddress: match.EmailAddress,
      Confirmed:    match.Confirmed,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[postmark-admin] FAILED to look up sender signature for ${email}: ${msg}`)
    throw err
  }
}
