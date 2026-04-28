'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Build an absolute URL on the caller's actual host. Mirrors the
// redirectOnHost helper in session.ts — same Next.js 16 dev-server
// quirk: relative redirects from server actions get resolved against
// `request.url`, which the framework normalizes to the bound interface
// (`http://localhost:3000`) even when the Host header was
// `app.localhost:3000`. The result is that `redirect('/')` after a
// sign-in posted to app.localhost lands the browser on localhost,
// which the proxy classifies as the marketing host and renders the
// landing page. Forcing an absolute URL with the caller's Host header
// keeps post-action navigation on the app subdomain.
async function urlOnCallerHost(path: string): Promise<string> {
  const h = await headers()
  const host  = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}${path}`
}

export async function login(formData: FormData) {
  try {
    const supabase = await createClient()

    // Normalise the email before every auth call. Supabase GoTrue already
    // lowercases on signup, but mirroring it here keeps legacy rows and
    // any upstream inconsistency from silently failing a sign-in.
    const email = String(formData.get('email') ?? '').trim().toLowerCase()
    const password = String(formData.get('password') ?? '')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) return { error: error.message }

    // Committal check #1: the password call has to give us back a session
    // object. If it didn't, the cookie adapter never received a payload to
    // write — redirecting now would land on an unauthenticated /login and
    // surface as a "double sign-in." This branch is mostly belt-and-
    // suspenders: GoTrue returns either an error or a session, never both
    // null, but we'd rather fail loudly than silently re-prompt.
    if (!data.session) {
      return { error: 'Session was not established. Please try again.' }
    }

    // Rotate the access token once more through the cookie adapter so
    // the navigation that follows lands with fresh cookies.
    // refreshSession may legitimately fail on flaky networks; the cookies
    // from signInWithPassword are still authoritative, so we swallow it.
    await supabase.auth.refreshSession().catch(() => null)

    // Committal check #2: read the JWT back through the cookie store.
    // If getUser returns null here, the browser is *about* to be redirected
    // to / with no session cookies — the sorting hat's Gate 0 would bounce
    // it back to /login. Catch that case and surface a clean error so the
    // user re-submits with a fresh form rather than seeing a silent loop.
    const { data: verified } = await supabase.auth.getUser()
    if (!verified.user) {
      return { error: 'Sign-in did not persist. Please try again.' }
    }

    // The centralized sorting hat in src/lib/supabase/session.ts is the
    // single source of truth for post-login routing. revalidatePath has
    // to fire BEFORE the navigation so the RSC cache for / is dropped
    // on the next request, and AFTER the committal checks above so we
    // never invalidate cache for a half-authenticated state.
    revalidatePath('/', 'layout')

    // Return the absolute redirect URL instead of calling next/navigation's
    // redirect(). Why: Next.js 16's server-action redirect() resolves any
    // URL we hand it against `request.url`, which the dev server normalizes
    // to its bound interface (`http://localhost:3000`) even when the Host
    // header says `app.localhost:3000`. The result is that even an
    // explicit absolute URL like `http://app.localhost:3000/` gets stripped
    // back to `http://localhost:3000/`, sending the browser to the marketing
    // host where session cookies are not visible. By returning the URL and
    // letting the client run `window.location.href = result.redirect`, the
    // browser does a hard navigation with the absolute URL we built — Next's
    // router isn't in the path to mangle it. Sorting hat in the proxy then
    // picks /hq / /{slug} / /onboarding / /pending-invite from there.
    return { redirect: await urlOnCallerHost('/') }
  } catch (err) {
    // Defensive: redirect() is no longer called above, but keep the
    // NEXT_REDIRECT rethrow in case any future code path adds one.
    const digest = (err as { digest?: unknown } | null)?.digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      throw err
    }
    console.error('[login-action] unexpected error:', err)
    return { error: err instanceof Error ? err.message : 'Unexpected server error' }
  }
}

// Global sign-out. supabase.auth.signOut() defaults to scope 'global',
// which revokes the refresh token server-side and clears every sb-*
// cookie via the createServerClient cookie adapter. revalidatePath
// flushes any rendered dashboard segments from the server cache before
// redirecting straight to /login. We used to redirect to / and let the
// proxy's Gate 0 bounce the now-anonymous user to /login, which works
// today but adds a hop. Targeting /login directly drops that hop and
// makes the post-logout destination explicit at the call site.
export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect(await urlOnCallerHost('/login'))
}
