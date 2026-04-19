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

  // HQ admins go straight to the Command Center; merchants to the dashboard.
  let destination = '/'
  if (data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('system_role')
      .eq('id', data.user.id)
      .single<{ system_role: 'platform_owner' | 'platform_support' | null }>()

    if (profile?.system_role) destination = '/admin-hq'
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
