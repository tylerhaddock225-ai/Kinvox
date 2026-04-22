// Shared claim-generation primitive. Consumed by both the HQ server
// action ("Send Claim Invite" button) and the /api/admin/organizations/
// generate-claim route so the mint + insert logic lives in exactly one
// place.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { mintToken, ttlFromNow, TTL } from '@/lib/auth/tokens'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'

export type GenerateClaimResult = {
  organization_id:   string
  organization_name: string
  email:             string
  token:             string   // raw — only in-memory + outbound email
  token_hash:        string
  expires_at:        string
  claim_url:         string
}

export type GenerateClaimError = { code: 'not_found' | 'db_error'; message: string }

export async function generateClaim(
  organizationId: string,
  email:          string,
): Promise<{ ok: true; data: GenerateClaimResult } | { ok: false; error: GenerateClaimError }> {
  const admin = createAdminClient()

  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('id, name, slug, deleted_at')
    .eq('id', organizationId)
    .maybeSingle<{ id: string; name: string; slug: string | null; deleted_at: string | null }>()

  if (orgErr) return { ok: false, error: { code: 'db_error', message: orgErr.message } }
  if (!org || org.deleted_at) {
    return { ok: false, error: { code: 'not_found', message: 'Organization not found' } }
  }

  const { raw: token, hash: tokenHash } = mintToken()
  const expiresAt = ttlFromNow(TTL.ORGANIZATION_CLAIM)

  const { error: insErr } = await admin
    .from('organization_claims')
    .insert({
      organization_id: org.id,
      token_hash:      tokenHash,
      email,
      expires_at:      expiresAt,
    })
  if (insErr) return { ok: false, error: { code: 'db_error', message: insErr.message } }

  return {
    ok: true,
    data: {
      organization_id:   org.id,
      organization_name: org.name,
      email,
      token,
      token_hash:        tokenHash,
      expires_at:        expiresAt,
      claim_url:         `${APP_URL}/claim/${token}`,
    },
  }
}
