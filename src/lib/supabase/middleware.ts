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

  // Refresh session on every request so a valid cookie survives
  // across fresh tabs / reloads — this is what powers the session
  // persistence the sorting hat in src/app/page.tsx depends on.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute  = pathname.startsWith('/login')
                    || pathname.startsWith('/signup')
                    || pathname.startsWith('/forgot-password')
                    || pathname.startsWith('/reset-password')
  const isOnboarding = pathname.startsWith('/onboarding')
  const isPending    = pathname.startsWith('/pending-invite')
  const isAdmin      = pathname.startsWith('/admin')
  const isWebhook    = pathname.startsWith('/api/webhooks/')
  const isAuthApi    = pathname.startsWith('/api/auth/')
  const isPublic     = isAuthRoute || isWebhook || isAuthApi || pathname.startsWith('/_next') || pathname === '/favicon.ico'

  // Login-first: any protected route reached without a session
  // bounces to /login. This covers dashboards, leads, settings,
  // tickets, admin-hq, onboarding, pending-invite — everything
  // except the explicit isPublic allowlist above.
  if (!user && !isPublic) {
    return noStore(NextResponse.redirect(new URL('/login', request.url)))
  }

  // Authenticated + visiting login/signup → dashboard
  if (user && isAuthRoute) {
    return noStore(NextResponse.redirect(new URL('/', request.url)))
  }

  // Authenticated + no org → pending-invite (or /onboarding if an
  // invite token is present on the user). Self-serve org creation
  // was removed; see supabase/migrations/20260420000000_invite_only_org_insert.sql.
  // Skip for onboarding/pending/admin to avoid an extra DB call on every request.
  if (user && !isOnboarding && !isPending && !isAdmin && !isPublic) {
    // Force a token refresh before reading tenant state. Mirrors the
    // /api/auth/force-sync pattern that reliably recovered a stuck
    // session — guarantees the JWT the RLS-gated read below runs
    // against is the freshest one, not a cookie-cache artefact.
    await supabase.auth.refreshSession().catch(() => null)

    // Direct profiles select instead of is_admin_hq / auth_user_org_id
    // RPC pair: one round trip, no SECURITY DEFINER plan-cache surprises,
    // and exactly what force-sync does. We also re-hydrate `user` so the
    // user_metadata read below (for the invite flag) is against the
    // refreshed session rather than the stale one from above.
    const { data: { user: refreshedUser } } = await supabase.auth.getUser()
    const activeUser = refreshedUser ?? user

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, system_role')
      .eq('id', activeUser.id)
      .single<{ organization_id: string | null; system_role: string | null }>()

    const orgId = profile?.organization_id ?? null
    const isHq  = !!profile?.system_role

    if (!orgId && !isHq) {
      const hasInvite = Boolean(
        (activeUser.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
      )
      return noStore(NextResponse.redirect(
        new URL(hasInvite ? '/onboarding' : '/pending-invite', request.url)
      ))
    }

    // Permission check: block /leads if view_leads is explicitly false.
    if (pathname.startsWith('/leads')) {
      const { data: canView } = await supabase.rpc('auth_user_view_leads')
      if (canView === false) {
        return noStore(NextResponse.redirect(new URL('/', request.url)))
      }
    }
  }

  return noStore(supabaseResponse)
}
