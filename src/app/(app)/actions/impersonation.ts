'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation'

// 4h — impersonation sessions auto-expire so a forgotten "View as Merchant"
// click doesn't leave the cookie set indefinitely.
const MAX_AGE_SECONDS = 60 * 60 * 4

export async function startImpersonation(formData: FormData) {
  const orgId = String(formData.get('orgId') ?? '').trim()
  if (!orgId) redirect('/admin-hq/organizations')

  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')

  // Fetch slug up-front so we can land directly on the merchant's slugged URL.
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .single<{ slug: string | null }>()
  if (!org?.slug) redirect('/admin-hq/organizations')

  const jar = await cookies()
  jar.set(IMPERSONATION_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
  })

  revalidatePath('/', 'layout')
  redirect(`/${org.slug}`)
}

export async function stopImpersonation() {
  const jar = await cookies()
  jar.delete(IMPERSONATION_COOKIE)

  revalidatePath('/', 'layout')
  redirect('/admin-hq')
}
