'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  resolveEnabledFeatures,
  type AiTemplate,
} from '@/lib/ai-templates'

async function requirePlatformOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single<{ system_role: string | null }>()

  if (profile?.system_role !== 'platform_owner') redirect('/login')
  return supabase
}

export async function setOrgAiStrategy(formData: FormData) {
  const orgId      = String(formData.get('org_id')      ?? '').trim()
  const templateId = String(formData.get('template_id') ?? '').trim()
  if (!orgId) redirect('/hq/organizations')

  const supabase = await requirePlatformOwner()

  // "" from the dropdown means "no template assigned" — clear both fields
  // so a stale toggle map doesn't outlive the template that defined it.
  if (!templateId) {
    await supabase
      .from('organizations')
      .update({ ai_template_id: null, enabled_ai_features: {} })
      .eq('id', orgId)

    revalidatePath(`/hq/organizations/${orgId}`)
    redirect(`/hq/organizations/${orgId}`)
  }

  const { data: template } = await supabase
    .from('ai_templates')
    .select('id, name, industry, base_prompt, metadata')
    .eq('id', templateId)
    .single<AiTemplate>()

  if (!template) {
    // Template vanished between page load and submit — don't write a
    // dangling FK; bounce back so the user re-selects.
    redirect(`/hq/organizations/${orgId}`)
  }

  // Build the toggle map from form fields. Checkbox semantics: only
  // checked boxes appear in FormData, so the absence of a key means
  // false (we don't want it to fall back to default_enabled here — the
  // user explicitly unchecked it).
  const toggles: Record<string, boolean> = {}
  for (const f of (template.metadata?.features ?? [])) {
    toggles[f.key] = formData.get(`feature_${f.key}`) === 'on'
  }

  // Resolve once more so unknown form keys are stripped and any feature
  // the template added since page-render gets its default value.
  const enabled = resolveEnabledFeatures(template, toggles)

  await supabase
    .from('organizations')
    .update({
      ai_template_id:      template.id,
      enabled_ai_features: enabled,
    })
    .eq('id', orgId)

  revalidatePath(`/hq/organizations/${orgId}`)
  redirect(`/hq/organizations/${orgId}`)
}
