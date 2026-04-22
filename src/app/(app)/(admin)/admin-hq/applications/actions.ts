'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function approveApplication(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await createClient()
  const { error } = await supabase.rpc('approve_merchant_application', {
    application_id: id,
  })

  if (error) {
    // The RPC already raised with a meaningful code; surface as a
    // thrown error so Next's error boundary shows the message. HQ-only
    // surface so leaking the message is acceptable.
    throw new Error(`Approve failed: ${error.message}`)
  }

  revalidatePath('/admin-hq/applications')
  revalidatePath('/admin-hq/organizations')
}
