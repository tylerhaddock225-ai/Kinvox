'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
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

  // HQ admins → Command Center. Merchants → their org's slugged dashboard.
  let destination = '/'
  if (data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('system_role, organizations(slug)')
      .eq('id', data.user.id)
      .single<{
        system_role: 'platform_owner' | 'platform_support' | null
        organizations: { slug: string | null } | null
      }>()

    if (profile?.system_role) {
      destination = '/admin-hq'
    } else if (profile?.organizations?.slug) {
      destination = `/${profile.organizations.slug}`
    } else {
      const hasInvite = Boolean(
        (data.user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
      )
      destination = hasInvite ? '/onboarding' : '/pending-invite'
    }
  }

  revalidatePath('/', 'layout')
  redirect(destination)
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
