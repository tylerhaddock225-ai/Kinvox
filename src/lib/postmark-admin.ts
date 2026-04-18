// Postmark Account API helpers. NEVER import this from client components —
// `POSTMARK_ACCOUNT_TOKEN` is a server-only secret that controls the entire
// Postmark account (sender signatures, servers, domains).

import { AccountClient } from 'postmark'

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
 * Returns the Postmark signature record (includes `ID` and `Confirmed: false`
 * until the customer verifies). On failure, throws and logs the error.
 */
export async function createSenderSignature(email: string, name: string) {
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
    return signature
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[postmark-admin] FAILED to create sender signature for ${email}: ${msg}`)
    throw err
  }
}
