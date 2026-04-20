'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Invite-only onboarding: the org row is pre-created by Admin HQ.
// This action links the signed-in invitee to that org via the
// finalize_invited_org_membership() RPC (SECURITY DEFINER) and
// redirects to the workspace on success.
export async function acceptInvite() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: slug, error } = await supabase.rpc('finalize_invited_org_membership')
  if (error) return { error: error.message }
  if (!slug)  return { error: 'Invitation could not be validated. Contact support.' }

  revalidatePath('/', 'layout')
  redirect(`/${slug}`)
}
