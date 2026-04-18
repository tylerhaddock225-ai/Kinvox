'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function saveWidgetConfig(hidden: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  await supabase.from('user_dashboard_configs').upsert({
    user_id:         user.id,
    organization_id: profile?.organization_id ?? null,
    hidden_widgets:  hidden,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'user_id' })

  revalidatePath('/')
}
