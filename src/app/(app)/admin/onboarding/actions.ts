'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
}

export async function setSubscriptionStatus(orgId: string, status: 'unpaid' | 'active') {
  await assertAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .from('organizations')
    .update({ subscription_status: status })
    .eq('id', orgId)

  if (error) return { error: error.message }

  revalidatePath('/admin/onboarding')
  return { success: true }
}

export async function inviteOrgOwner(orgId: string, ownerEmail: string) {
  await assertAdmin()
  const admin = createAdminClient()

  const normalised = ownerEmail.trim().toLowerCase()

  const { error } = await admin.auth.admin.inviteUserByEmail(normalised, {
    data: { invited_to_org: orgId },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/onboarding`,
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/onboarding')
  return { success: true }
}
