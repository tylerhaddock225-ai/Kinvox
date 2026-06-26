'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'

export async function saveWidgetConfig(hidden: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Impersonation-aware: an HQ admin customizing the dashboard while "acting
  // as" a tenant pins the config to the EFFECTIVE (impersonated) org, not their
  // own (post-decouple null) profile org. For normal tenant users effective org
  // == raw profile org, so behavior is unchanged. organization_id is nullable
  // and the read-back (dashboard page) is keyed on user_id only, so a null
  // effective org is still a valid best-effort write.
  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  await supabase.from('user_dashboard_configs').upsert({
    user_id:         user.id,
    organization_id: orgId,
    hidden_widgets:  hidden,
    updated_at:      new Date().toISOString(),
  }, { onConflict: 'user_id' })

  revalidatePath('/')
}
