'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
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

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
