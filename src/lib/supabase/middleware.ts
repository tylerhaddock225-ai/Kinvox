import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // Refresh session — do not remove this line
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

  // Unauthenticated → login
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Authenticated + visiting login/signup → dashboard
  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Authenticated + no org → pending-invite (or /onboarding if an
  // invite token is present on the user). Self-serve org creation
  // was removed; see supabase/migrations/20260420000000_invite_only_org_insert.sql.
  // Skip for onboarding/pending/admin to avoid an extra DB call on every request.
  if (user && !isOnboarding && !isPending && !isAdmin && !isPublic) {
    const { data: orgId } = await supabase.rpc('auth_user_org_id')
    if (!orgId) {
      const hasInvite = Boolean(
        (user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
      )
      return NextResponse.redirect(
        new URL(hasInvite ? '/onboarding' : '/pending-invite', request.url)
      )
    }

    // Permission check: block /leads if view_leads is explicitly false.
    if (pathname.startsWith('/leads')) {
      const { data: canView } = await supabase.rpc('auth_user_view_leads')
      if (canView === false) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
  }

  return supabaseResponse
}
