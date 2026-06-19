/**
 * updateSession — the auth + sorting-hat pass of the proxy pipeline.
 *
 * Invoked from `src/proxy.ts` on every request that reaches the app
 * host (hostname gating happens upstream — this file never checks host
 * names). Responsibilities:
 *   - Refresh the Supabase session cookie
 *   - Gate 0: unauth user on a protected path → /login
 *   - Gate 1: auth user on /login|/signup|etc → /
 *   - Gate 2: centralized sorting hat for /, /pending-invite, /onboarding.
 *     Decides the user's one legitimate destination from profile state:
 *     @kinvoxtech.com email OR platform_* → /hq,
 *     tenant member → /{slug}, invitee → /onboarding,
 *     otherwise → /pending-invite.
 *   - Gate 3: orphan guard on any other protected path — users without
 *     an org AND without a platform role get bounced to /pending-invite.
 *     The internal Team (anyone on @kinvoxtech.com) is exempt so a fresh
 *     hire without a system_role can still reach /hq while ops finishes
 *     provisioning their profile.
 *
 * Response cache is no-store'd so BFCache can't replay a stale dashboard
 * after logout (see noStore helper).
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isTeamEmail } from '@/lib/auth/is-team'
import type { SystemRole } from '@/lib/types/auth'

// Tag every response with no-store + no-cache so the browser (and
// BFCache in most browsers) won't replay a rendered dashboard after
// the user signs out and clicks Back. Pair with revalidatePath in
// the logout action to flush the server-side render cache too.
function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
  res.headers.set('Pragma', 'no-cache')
  return res
}

// Build a redirect that preserves the request's actual Host header.
// In Next.js 16's dev server, `request.url` is normalized to the bound
// interface (`http://localhost:3000`) even when the Host header is a
// subdomain like `app.localhost:3000`. That means
// `new URL('/login', request.url)` would emit a Location pointing at
// the marketing host, cross-jumping the user off the app subdomain
// mid-flow and rendering the (marketing) tree on the next request.
// Reading from `request.headers` keeps redirects on the caller's host.
function redirectOnHost(request: NextRequest, path: string): NextResponse {
  const host  = request.headers.get('host') ?? request.nextUrl.host
  const proto = request.headers.get('x-forwarded-proto')
             ?? request.nextUrl.protocol.replace(/:$/, '')
  return NextResponse.redirect(`${proto}://${host}${path}`, 307)
}

// All routes where we run the centralized sorting hat. On every
// other protected route we just enforce the orphan guard — we do
// NOT forcibly redirect users away from valid destinations, so
// direct URL navigation / impersonation / bookmarks still work.
function isSortingHatPath(pathname: string): boolean {
  return pathname === '/'
      || pathname === '/pending-invite'
      || pathname === '/onboarding'
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Validate the incoming JWT up front. This is also what powers
  // session persistence on fresh tabs.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute  = pathname.startsWith('/login')
                    || pathname.startsWith('/signup')
                    || pathname.startsWith('/forgot-password')
                    || pathname.startsWith('/reset-password')
  // Orphan-guard exemption: any HQ surface (route tree at /hq) and the
  // server-action API under /api/admin/* — both are gated independently
  // so an HQ admin without a tenant org doesn't get bounced to
  // /pending-invite when navigating between organizations.
  const isAdmin      = pathname.startsWith('/hq') || pathname.startsWith('/api/admin/')
  const isWebhook    = pathname.startsWith('/api/webhooks/')
  const isAuthApi    = pathname.startsWith('/api/auth/')
  // Anonymous lead-magnet landing pages + their public capture endpoint.
  // These must be reachable without a session on the app host.
  const isLeadMagnet = pathname.startsWith('/l/')
  const isPublicApi  = pathname.startsWith('/api/v1/')
  // Claim landing is public-facing: unauthenticated visitors see a
  // "Sign in to claim" CTA, signed-in users see the confirmation UI.
  const isClaim      = pathname.startsWith('/claim/')
  // Invite landing is public-facing: an unauthenticated invitee resolves the
  // token, sets a password, and is auto-signed-in (mirrors /claim/).
  const isInvite     = pathname.startsWith('/invite/')
  const isPublic     = isAuthRoute || isWebhook || isAuthApi || isLeadMagnet || isPublicApi || isClaim || isInvite || pathname.startsWith('/_next') || pathname === '/favicon.ico'

  // ── Gate 0: login-first ────────────────────────────────────
  // Every protected route bounces unauthenticated requests to /login.
  if (!user && !isPublic) {
    return noStore(redirectOnHost(request, '/login'))
  }

  // ── Gate 1: already authenticated visiting /login, /signup, etc. ──
  if (user && isAuthRoute) {
    return noStore(redirectOnHost(request, '/'))
  }

  // ── Gate 2: centralized sorting hat ────────────────────────
  // Single source of truth for role-based routing. Only fires on
  // /, /pending-invite, /onboarding — the three "am I on the right
  // page?" decision points. Everything else is trusted (subject to
  // the orphan guard below).
  if (user && isSortingHatPath(pathname)) {
    // Hotfix-B: do NOT call refreshSession() here. Concurrent requests (document +
    // RSC prefetches) racing on a single-use refresh token caused losing racers to
    // null their session, then read profiles as anon → RLS returned 0 rows →
    // hasOrg=false → /pending-invite. The @supabase/ssr client auto-refreshes
    // lazily on actual 401s; pre-refreshing here is both unnecessary and harmful.
    // Hotfix-C: dropped the embedded organizations slug select. profiles ↔ organizations has
    // two foreign keys (profiles.organization_id → orgs, organizations.owner_id →
    // profiles), so the PostgREST embed was ambiguous (PGRST201), silently failed the
    // whole .single() query, and returned profile=null for every tenant user, sending
    // them to /pending-invite. Fix: fetch profile without embed, then resolve slug in
    // a separate query.
    const { data: profile } = await supabase
      .from('profiles')
      .select('system_role, organization_id')
      .eq('id', user.id)
      .single<{ system_role: SystemRole | null; organization_id: string | null }>()

    // Resolve slug separately when org_id is set. Safe to fail — orgSlug stays null
    // and Hotfix-A's '/' fallback covers it as defense in depth (should not fire in
    // normal operation, but kept as a safety net).
    let orgSlug: string | null = null
    if (profile?.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('slug')
        .eq('id', profile.organization_id)
        .maybeSingle<{ slug: string | null }>()
      orgSlug = org?.slug ?? null
    }

    const role       = profile?.system_role ?? null
    const isPlatform = typeof role === 'string' && role.startsWith('platform_')
    // Hotfix-A: organization_id alone determines tenant status; slug is for URL only.
    // Pre-redesign safety net (Workstream M will replace this with the three-state model).
    const hasOrg     = Boolean(profile?.organization_id)
    const hasInvite  = Boolean(
      (user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
    )
    // Internal-Team shortcut: anyone signed in with a @kinvoxtech.com
    // email is on the Kinvox team. They route to /hq even before their
    // profiles.system_role is provisioned — so a brand-new hire who
    // logged in for the first time still lands on the HQ surface
    // instead of /pending-invite. The predicate is shared with the HQ
    // layout's gate via isTeamEmail() so both stay in lockstep.
    const isTeam = isTeamEmail(user.email)

    // Compute the ONE destination this user belongs at. Priority
    // matches the manifest: HQ staff (Team email OR platform_*) → /hq,
    // tenant members → /{slug} (the merchant dashboard lives at /{slug},
    // not /{slug}/dashboard — see src/app/(dashboard)/[orgSlug]/page.tsx),
    // invitees → /onboarding, everyone else → /pending-invite.
    let destination: string
    if (isTeam || isPlatform) {
      destination = '/hq'
    } else if (hasOrg) {
      // Hotfix-A: organization_id alone determines tenant status; slug is for URL only.
      // Pre-redesign safety net (Workstream M will replace this with the three-state model).
      // When org_id is set but the embed couldn't resolve the slug, route to '/'; the
      // dashboard layout re-resolves the org context so the user lands without bouncing.
      destination = orgSlug ? `/${orgSlug}` : '/'
    } else if (hasInvite) {
      destination = '/onboarding'
    } else {
      destination = '/pending-invite'
    }

    if (pathname !== destination) {
      return noStore(redirectOnHost(request, destination))
    }
    // else the user is already where they belong — fall through.
  }

  // ── Gate 3: orphan guard on protected tenant routes ───────
  // If a signed-in user lands on a dashboard / leads / tickets /
  // settings path without either a tenant org OR an HQ role, they
  // get sent to /pending-invite. This stops direct URL navigation
  // from bypassing the sorting hat. Does not fire on /hq/*,
  // /api/admin/*, the sorting-hat paths themselves, or public routes.
  // Internal Team email is also exempt — see the Gate 2 comment.
  if (user && !isAdmin && !isPublic && !isSortingHatPath(pathname)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, system_role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; system_role: string | null }>()

    const isPlatform = typeof profile?.system_role === 'string'
                    && profile.system_role.startsWith('platform_')
    // Hotfix-A: organization_id alone determines tenant status; slug is for URL only.
    // Pre-redesign safety net (Workstream M will replace this with the three-state model).
    const hasOrg     = Boolean(profile?.organization_id)

    if (!isTeamEmail(user.email) && !isPlatform && !hasOrg) {
      return noStore(redirectOnHost(request, '/pending-invite'))
    }

    // Permission check: block /leads if view_leads is explicitly false.
    if (pathname.startsWith('/leads')) {
      const { data: canView } = await supabase.rpc('auth_user_view_leads')
      if (canView === false) {
        return noStore(redirectOnHost(request, '/'))
      }
    }
  }

  return noStore(supabaseResponse)
}
