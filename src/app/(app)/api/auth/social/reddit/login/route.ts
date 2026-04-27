// GET /api/auth/social/reddit/login
//
// Initiator for the Reddit OAuth handshake. Resolves the *effective* org id
// (own profile.org or the impersonated org for HQ admins), signs it into
// the OAuth `state` parameter, drops the matching nonce in an HttpOnly
// cookie, and 302s the browser to Reddit's authorize endpoint.
//
// Zero-Inference: the org id is NEVER taken from the URL. It is resolved
// server-side from the session and verified at callback via HMAC + cookie
// nonce. The Reddit `state` round-trip carries only the signed blob.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import {
  createSignedState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from '@/lib/oauth-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Reddit minimum scope set for our writer:
//   identity → /api/v1/me to fetch the connected handle
//   submit   → /api/comment to post replies
//   read     → fetch parent thread context (future use)
//   edit     → delete/edit our own replies if a tenant retracts
const REDDIT_SCOPES = 'identity submit read edit'

export async function GET(request: NextRequest) {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim()
  const appBase  = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!clientId) return new NextResponse('reddit_oauth_not_configured', { status: 503 })
  if (!appBase)  return new NextResponse('app_base_url_not_configured', { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const next = encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(new URL(`/login?next=${next}`, appBase))
  }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return new NextResponse('no_organization', { status: 403 })

  // Tenant role gate mirrors the settings page itself — if the tenant
  // user isn't an admin, they shouldn't be able to bind credentials for
  // the org. HQ admins skip this via the impersonation path.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single<{ role: string | null; organization_id: string | null }>()

  const impersonating = profile?.organization_id !== orgId
  if (!impersonating && profile?.role !== 'admin') {
    return new NextResponse('forbidden', { status: 403 })
  }

  const { state, nonce } = createSignedState(orgId)
  const redirectUri      = `${appBase.replace(/\/$/, '')}/api/auth/social/reddit/callback`

  const authorizeUrl = new URL('https://www.reddit.com/api/v1/authorize')
  authorizeUrl.searchParams.set('client_id',     clientId)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('state',         state)
  authorizeUrl.searchParams.set('redirect_uri',  redirectUri)
  authorizeUrl.searchParams.set('duration',      'permanent')   // ask for refresh_token
  authorizeUrl.searchParams.set('scope',         REDDIT_SCOPES)

  const res = NextResponse.redirect(authorizeUrl.toString())
  res.cookies.set({
    name:     OAUTH_STATE_COOKIE,
    value:    nonce,
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   Math.floor(OAUTH_STATE_TTL_MS / 1000),
  })
  return res
}
