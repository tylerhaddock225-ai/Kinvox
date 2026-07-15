'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hqGate } from '@/lib/permissions/gates'
import {
  resolveEnabledFeatures,
  type AiTemplate,
} from '@/lib/ai-templates'

// In-place HQ toggles write individual organizations.feature_flags keys. Only
// these product-capability flags may be written — an allowlist so a caller can
// never inject an arbitrary key into the jsonb.
type FeatureFlagState = { status: 'success' } | { status: 'error'; error: string } | null
const TOGGLEABLE_FLAGS = new Set(['ai_support_enabled', 'review_monitoring_enabled'])

export async function setOrgAiStrategy(formData: FormData) {
  const orgId      = String(formData.get('org_id')      ?? '').trim()
  const templateId = String(formData.get('template_id') ?? '').trim()
  if (!orgId) redirect('/hq/organizations')

  // K2b intentional widening: this action was previously platform_owner-only
  // (the old requirePlatformOwner helper). It now opens to any HQ role granted
  // `manage_ai_templates`; platform_owner still bypasses every check via
  // isSuperAdmin inside hqGate, so the prior caller set is preserved.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const gate = await hqGate(supabase, user.id, 'manage_ai_templates')
  if (!gate.ok) redirect('/login')

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

/**
 * In-place HQ toggle for a single `organizations.feature_flags` key. Mirrors
 * setOrgAiStrategy's guard (regular createClient + hqGate 'manage_ai_templates')
 * but returns State instead of redirecting (it's a settings toggle, not a wizard
 * step). READ-MODIFY-WRITEs the jsonb so every other flag is preserved, and only
 * ever writes an allowlisted key — it never touches ai_template_id,
 * enabled_ai_features, or any other column.
 */
export async function setOrgFeatureFlag(
  _prev:    FeatureFlagState,
  formData: FormData,
): Promise<FeatureFlagState> {
  const orgId = String(formData.get('org_id') ?? '').trim()
  const flag  = String(formData.get('flag')   ?? '').trim()
  const value = String(formData.get('value')  ?? '').trim()

  if (!orgId) return { status: 'error', error: 'Missing organization' }
  if (!TOGGLEABLE_FLAGS.has(flag)) {
    return { status: 'error', error: 'Invalid feature flag' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const gate = await hqGate(supabase, user.id, 'manage_ai_templates')
  if (!gate.ok) return { status: 'error', error: 'Not authorized' }

  // Read the current flags so the merge preserves every other key
  // (lead_magnet_enabled, embed_enabled, …) — a wholesale write would wipe them.
  const { data: org, error: readErr } = await supabase
    .from('organizations')
    .select('feature_flags')
    .eq('id', orgId)
    .single<{ feature_flags: Record<string, unknown> | null }>()

  if (readErr || !org) {
    return { status: 'error', error: 'Organization not found' }
  }

  // MERGE, never replace.
  const next = { ...(org.feature_flags ?? {}), [flag]: value === 'true' }

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ feature_flags: next })
    .eq('id', orgId)

  if (updErr) {
    return { status: 'error', error: updErr.message }
  }

  revalidatePath(`/hq/organizations/${orgId}`)
  return { status: 'success' }
}
