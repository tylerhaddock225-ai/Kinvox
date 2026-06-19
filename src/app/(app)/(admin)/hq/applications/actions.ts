'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { hqGate } from '@/lib/permissions/gates'

export async function approveApplication(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await createClient()
  // K2b: first-ever explicit gate. Previously this relied solely on the /hq
  // layout guard + the RPC's SECURITY DEFINER internals. Fail-closed with a
  // bare return to match the function's void contract (no mutation occurs).
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const gate = await hqGate(supabase, user.id, 'approve_applications')
  if (!gate.ok) return

  const { error } = await supabase.rpc('approve_organization_application', {
    application_id: id,
  })

  if (error) {
    // The RPC already raised with a meaningful code; surface as a
    // thrown error so Next's error boundary shows the message. HQ-only
    // surface so leaking the message is acceptable.
    throw new Error(`Approve failed: ${error.message}`)
  }

  revalidatePath('/hq/applications')
  revalidatePath('/hq/organizations')
}
