'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type Plan = 'free' | 'pro' | 'enterprise'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')
  return supabase
}

export async function updateOrganization(formData: FormData) {
  const id       = String(formData.get('id')       ?? '').trim()
  const name     = String(formData.get('name')     ?? '').trim()
  const vertical = String(formData.get('vertical') ?? '').trim()
  const plan     = String(formData.get('plan')     ?? '').trim() as Plan
  if (!id || !name) redirect('/admin-hq/organizations')

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({
      name,
      vertical: vertical || null,
      plan,
    })
    .eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
  redirect(`/admin-hq/organizations/${id}`)
}

export async function setOrgStatus(formData: FormData) {
  const id     = String(formData.get('id')     ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()
  if (!id || !status) return

  const supabase = await requireAdmin()
  await supabase.from('organizations').update({ status }).eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
}

export async function archiveOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/admin-hq/organizations')
  redirect('/admin-hq/organizations')
}

export async function restoreOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({ deleted_at: null })
    .eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
}
