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
 *     platform_* → /admin-hq, tenant member → /{slug}, invitee →
 *     /onboarding, otherwise → /pending-invite.
 *   - Gate 3: orphan guard on any other protected path — users without
 *     an org AND without a platform role get bounced to /pending-invite.
 *
 * Response cache is no-store'd so BFCache can't replay a stale dashboard
 * after logout (see noStore helper).
 */
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Tag every response with no-store + no-cache so the browser (and
// BFCache in most browsers) won't replay a rendered dashboard after
// the user signs out and clicks Back. Pair with revalidatePath in
// the logout action to flush the server-side render cache too.
function noStore(res: NextResponse) {
  res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
  res.headers.set('Pragma', 'no-cache')
  return res
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
  const isAdmin      = pathname.startsWith('/admin')
  const isWebhook    = pathname.startsWith('/api/webhooks/')
  const isAuthApi    = pathname.startsWith('/api/auth/')
  const isPublic     = isAuthRoute || isWebhook || isAuthApi || pathname.startsWith('/_next') || pathname === '/favicon.ico'

  // ── Gate 0: login-first ────────────────────────────────────
  // Every protected route bounces unauthenticated requests to /login.
  if (!user && !isPublic) {
    return noStore(NextResponse.redirect(new URL('/login', request.url), 307))
  }

  // ── Gate 1: already authenticated visiting /login, /signup, etc. ──
  if (user && isAuthRoute) {
    return noStore(NextResponse.redirect(new URL('/', request.url), 307))
  }

  // ── Gate 2: centralized sorting hat ────────────────────────
  // Single source of truth for role-based routing. Only fires on
  // /, /pending-invite, /onboarding — the three "am I on the right
  // page?" decision points. Everything else is trusted (subject to
  // the orphan guard below).
  if (user && isSortingHatPath(pathname)) {
    // Force a token refresh so the downstream profile read + any
    // redirect lands with the freshest cookies possible.
    await supabase.auth.refreshSession().catch(() => null)

    const { data: profile } = await supabase
      .from('profiles')
      .select('system_role, organization_id, organizations(slug)')
      .eq('id', user.id)
      .single<{
        system_role: string | null
        organization_id: string | null
        organizations: { slug: string | null } | null
      }>()

    const role       = profile?.system_role ?? null
    const isPlatform = typeof role === 'string' && role.startsWith('platform_')
    const orgSlug    = profile?.organizations?.slug ?? null
    const hasOrg     = Boolean(profile?.organization_id && orgSlug)
    const hasInvite  = Boolean(
      (user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
    )

    // Compute the ONE destination this user belongs at. Priority
    // matches the app spec: HQ staff → /admin-hq, tenant members →
    // /{slug} (note: the merchant dashboard lives at /{slug}, not
    // /{slug}/dashboard — see src/app/(dashboard)/[orgSlug]/page.tsx),
    // invitees → /onboarding, everyone else → /pending-invite.
    let destination: string
    if (isPlatform) {
      destination = '/admin-hq'
    } else if (hasOrg) {
      destination = `/${orgSlug}`
    } else if (hasInvite) {
      destination = '/onboarding'
    } else {
      destination = '/pending-invite'
    }

    if (pathname !== destination) {
      return noStore(NextResponse.redirect(new URL(destination, request.url), 307))
    }
    // else the user is already where they belong — fall through.
  }

  // ── Gate 3: orphan guard on protected tenant routes ───────
  // If a signed-in user lands on a dashboard / leads / tickets /
  // settings path without either a tenant org OR an HQ role, they
  // get sent to /pending-invite. This stops direct URL navigation
  // from bypassing the sorting hat. Does not fire on /admin-hq/*,
  // /api/*, the sorting-hat paths themselves, or public routes.
  if (user && !isAdmin && !isPublic && !isSortingHatPath(pathname)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, system_role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; system_role: string | null }>()

    const isPlatform = typeof profile?.system_role === 'string'
                    && profile.system_role.startsWith('platform_')
    const hasOrg     = !!profile?.organization_id

    if (!isPlatform && !hasOrg) {
      return noStore(NextResponse.redirect(new URL('/pending-invite', request.url), 307))
    }

    // Permission check: block /leads if view_leads is explicitly false.
    if (pathname.startsWith('/leads')) {
      const { data: canView } = await supabase.rpc('auth_user_view_leads')
      if (canView === false) {
        return noStore(NextResponse.redirect(new URL('/', request.url), 307))
      }
    }
  }

  return noStore(supabaseResponse)
}
