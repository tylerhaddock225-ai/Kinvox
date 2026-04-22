// Generator primitive for the Merchant Claim Flow.
//
// POST body: { organization_id?: string, email: string }
//   - If organization_id is omitted, falls back to the impersonation
//     cookie so the HQ can generate a claim from "View as Organization"
//     without re-plumbing org context.
// Response: see GenerateClaimResult in @/lib/claims.
//   - `token` is the RAW value — caller hands it to Postmark, never logs it.
//
// Auth: middleware requires a session; we additionally verify
// is_admin_hq() inside the handler so a tenant can never reach here
// even if the URL allowlist changes.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import { generateClaim } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Body = {
  organization_id?: string
  email?:           string
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('unauthenticated', 401)

  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) return bad('forbidden', 403)

  let body: Body
  try {
    body = await request.json() as Body
  } catch {
    return bad('Invalid JSON body')
  }

  // Fallback path: HQ admin acting through "View as Organization" may
  // not know the target org_id in-hand — pull it from the cookie.
  let organizationId = typeof body.organization_id === 'string' ? body.organization_id.trim() : ''
  if (!organizationId) {
    const impersonation = await resolveImpersonation()
    if (impersonation.active) organizationId = impersonation.orgId
  }
  if (!organizationId) return bad('Missing organization_id (or active impersonation)')

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return bad('Enter a valid email address')

  const result = await generateClaim(organizationId, email)
  if (!result.ok) {
    return bad(result.error.message, result.error.code === 'not_found' ? 404 : 500)
  }

  return NextResponse.json(result.data)
}
