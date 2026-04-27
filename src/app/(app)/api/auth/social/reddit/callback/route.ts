// GET /api/auth/social/reddit/callback
//
// Reddit OAuth return leg. Verifies the signed `state` against the nonce
// cookie set at /login, exchanges the auth code for an access + refresh
// token pair, fetches the connected handle, and persists the credential
// blob through the SECURITY DEFINER set_organization_credential RPC.
//
// Token storage: set_organization_credential takes a single text payload,
// so we serialize the full token bundle as JSON:
//   {"access_token":"…","refresh_token":"…","expires_at":"…","scope":"…"}
// The writer route (/api/v1/social/reddit/reply) currently treats the
// vault secret as a plain bearer string — it'll need a JSON-parse update
// in the follow-up ticket that wires up token refresh. No production code
// breaks today because no Reddit credentials existed before this flow.
//
// Zero-Inference: org id is recovered ONLY from the HMAC-signed state.
// Reddit's `state` echo + the local nonce cookie are both verified.

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  verifySignedState,
  OAUTH_STATE_COOKIE,
} from '@/lib/oauth-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RedditTokenResponse = {
  access_token?:  string
  refresh_token?: string
  token_type?:    string
  expires_in?:    number
  scope?:         string
  error?:         string
}

type RedditMeResponse = { name?: string }

function bounce(slug: string | null, params: Record<string, string>): NextResponse {
  const appBase = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  // KINV-017: Social Connections is now a tab inside Organization Settings
  // at /settings/team. Land there with the reddit=… param so TeamTabs
  // auto-switches to the Social tab and renders the success/error banner.
  const url = new URL(
    slug
      ? `/${encodeURIComponent(slug)}/settings/team`
      : '/',
    appBase,
  )
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = NextResponse.redirect(url.toString())
  // State cookie is single-use — clear it whichever branch we land in.
  res.cookies.set({ name: OAUTH_STATE_COOKIE, value: '', maxAge: 0, path: '/' })
  return res
}

export async function GET(request: NextRequest) {
  const clientId     = process.env.REDDIT_CLIENT_ID?.trim()
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim()
  const appBase      = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!clientId || !clientSecret || !appBase) {
    return new NextResponse('reddit_oauth_not_configured', { status: 503 })
  }

  const url   = request.nextUrl
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')   // user clicked "decline" on Reddit

  // Reddit can return ?error=access_denied — we surface a nice message
  // rather than a verification failure.
  if (error) {
    return bounce(null, { reddit: 'denied', detail: error })
  }
  if (!code || !state) {
    return bounce(null, { reddit: 'error', detail: 'missing_params' })
  }

  const cookieNonce = request.cookies.get(OAUTH_STATE_COOKIE)?.value
  const verified    = verifySignedState(state, cookieNonce)
  if (!verified) {
    return bounce(null, { reddit: 'error', detail: 'state_invalid' })
  }
  const { orgId } = verified

  const redirectUri = `${appBase.replace(/\/$/, '')}/api/auth/social/reddit/callback`

  // ── Exchange auth code for tokens ─────────────────────────────────────
  // Reddit requires HTTP Basic auth with the app's client_id:client_secret
  // and a non-default User-Agent. The redirect_uri must match exactly the
  // value we sent at /login.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  let tokenRes: RedditTokenResponse
  try {
    const r = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        authorization:  `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent':   'kinvox/1.0 (oauth)',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })
    tokenRes = (await r.json()) as RedditTokenResponse
    if (!r.ok || tokenRes.error || !tokenRes.access_token) {
      return bounce(null, {
        reddit: 'error',
        detail: tokenRes.error ?? `http_${r.status}`,
      })
    }
  } catch (err) {
    return bounce(null, {
      reddit: 'error',
      detail: err instanceof Error ? err.message : 'token_exchange_failed',
    })
  }

  // ── Fetch the connected handle for display ────────────────────────────
  // Best-effort — if /me fails we still persist the token, just without
  // the human-readable handle on the integrations card.
  let handle: string | null = null
  try {
    const me = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: {
        authorization: `bearer ${tokenRes.access_token}`,
        'user-agent':  'kinvox/1.0 (oauth)',
      },
    })
    if (me.ok) {
      const body = (await me.json()) as RedditMeResponse
      if (typeof body.name === 'string' && body.name.length > 0) {
        handle = `u/${body.name}`
      }
    }
  } catch {
    // swallow — handle stays null
  }

  // ── Persist via SECURITY DEFINER RPC ──────────────────────────────────
  // Bundle the access + refresh tokens as JSON inside the single vault
  // secret so we don't have to add a refresh_token_secret_id column right
  // now. The writer route will be updated to JSON-parse in a follow-up.
  const expiresAtIso =
    typeof tokenRes.expires_in === 'number'
      ? new Date(Date.now() + tokenRes.expires_in * 1000).toISOString()
      : null

  const credentialBlob = JSON.stringify({
    access_token:  tokenRes.access_token,
    refresh_token: tokenRes.refresh_token ?? null,
    expires_at:    expiresAtIso,
    scope:         tokenRes.scope ?? null,
  })

  const scopes = (tokenRes.scope ?? '').split(/\s+/).filter(Boolean)

  // Use the user-scoped client only to read the user's id for created_by.
  // The admin client invokes the RPC (service_role-only by GRANT).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { error: rpcErr } = await admin.rpc('set_organization_credential', {
    p_org_id:     orgId,
    p_platform:   'reddit',
    p_token:      credentialBlob,
    p_handle:     handle,
    p_scopes:     scopes,
    p_expires_at: expiresAtIso,
    p_created_by: user?.id ?? null,
  })

  // Resolve the org slug for the redirect target.
  const { data: orgRow } = await admin
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .maybeSingle<{ slug: string | null }>()

  if (rpcErr) {
    return bounce(orgRow?.slug ?? null, { reddit: 'error', detail: 'persist_failed' })
  }
  return bounce(orgRow?.slug ?? null, { reddit: 'connected' })
}
