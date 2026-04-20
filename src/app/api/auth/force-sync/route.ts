import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Temporary escape-hatch route. Visit /api/auth/force-sync in the browser
// when stuck on /pending-invite despite the server-side state being
// correct. This:
//   1. Refreshes the Supabase session (issues a fresh JWT + cookie).
//   2. Re-reads profiles.system_role directly, bypassing any stale
//      client render.
//   3. Redirects a confirmed platform_owner straight to /admin-hq.
//   4. For any other result, signs out so the next login starts
//      from a clean slate.
// Wrapped in no-store so the redirect response can't be cached.
function noStoreRedirect(url: URL) {
  const res = NextResponse.redirect(url)
  res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
  res.headers.set('Pragma', 'no-cache')
  return res
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  // Force a token refresh. If there is no session to refresh, this
  // fails quietly and getUser() returns null — we'll bounce to /login.
  await supabase.auth.refreshSession().catch(() => null)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return noStoreRedirect(new URL('/login', request.url))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single<{ system_role: 'platform_owner' | 'platform_support' | null }>()

  if (profile?.system_role === 'platform_owner') {
    return noStoreRedirect(new URL('/admin-hq', request.url))
  }

  // Anything else — no profile, null system_role, platform_support, or
  // any surprise value — hard-reset. Per spec, sign out and send to login.
  await supabase.auth.signOut()
  return noStoreRedirect(new URL('/login', request.url))
}
