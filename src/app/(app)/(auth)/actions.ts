'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

    // Rotate the access token once more through the cookie adapter so
    // the next request (the redirect to /) lands with fresh cookies.
    await supabase.auth.refreshSession().catch(() => null)
    await supabase.auth.getUser().catch(() => null)

    // The centralized sorting hat in src/lib/supabase/session.ts is the
    // single source of truth for post-login routing. We always redirect
    // to /, and the proxy picks the correct destination (/admin-hq,
    // /{slug}, /onboarding, or /pending-invite) based on system_role +
    // organization_id + invite metadata.
    revalidatePath('/', 'layout')
  } catch (err) {
    // Next's redirect() throws a sentinel with digest NEXT_REDIRECT; never
    // swallow it or navigation breaks. Only log unexpected errors.
    const digest = (err as { digest?: unknown } | null)?.digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      throw err
    }
    console.error('[login-action] unexpected error:', err)
    return { error: err instanceof Error ? err.message : 'Unexpected server error' }
  }

  redirect('/')
}

// Global sign-out. supabase.auth.signOut() defaults to scope 'global',
// which revokes the refresh token server-side and clears every sb-*
// cookie via the createServerClient cookie adapter. revalidatePath
// flushes any rendered dashboard segments from the server cache before
// redirecting to '/', where the middleware + root sorting hat bounce
// the now-anonymous user to /login.
export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}
