// Server-only resolver: org → assigned template → final prompt with the
// merchant's disabled-feature blocks stripped out. Lives next to
// ai-templates.ts (types) but stays separate so client bundles never pull
// the supabase server client transitively.

import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  getTemplateFeatures,
  resolveEnabledFeatures,
  type AiTemplate,
  type AiTemplateFeature,
} from '@/lib/ai-templates'

export type ResolvedAiPrompt = {
  organization_id: string
  template:        AiTemplate | null
  features:        AiTemplateFeature[]
  enabled:         Record<string, boolean>
  prompt:          string
}

// Markers the seed prompts use to delimit per-feature instructions.
// Keep this contract narrow: single-line opening tag, single-line closing
// tag, both on their own lines so we can match-and-strip without touching
// surrounding paragraphs. If you change the format here, change the seed.
const FEATURE_BLOCK = (key: string) =>
  new RegExp(
    String.raw`(?:\r?\n)?\[\[FEATURE:${escapeRe(key)}\]\][\s\S]*?\[\[\/FEATURE:${escapeRe(key)}\]\](?:\r?\n)?`,
    'g',
  )

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Strip blocks for any feature the merchant has toggled off, then strip
 * the surviving tag lines so the model never sees the markup itself.
 * Unknown blocks (a feature key that exists in the prompt but not in the
 * template metadata) are left intact — that's a template-authoring
 * concern, not a runtime one.
 */
export function applyFeatureGating(
  basePrompt: string,
  features: AiTemplateFeature[],
  enabled: Record<string, boolean>,
): string {
  let out = basePrompt
  for (const f of features) {
    if (!enabled[f.key]) {
      out = out.replace(FEATURE_BLOCK(f.key), '\n')
    }
  }
  // Strip surviving open/close tags for enabled features.
  out = out.replace(/^\s*\[\[\/?FEATURE:[^\]]+\]\]\s*$/gm, '')
  // Collapse the run of blank lines that stripping leaves behind.
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Resolve the prompt for a given org. Returns `template: null` when the
 * org has no template assigned — callers should treat that as "AI is off
 * for this merchant" rather than falling back to a default.
 */
export async function resolveAiPromptForOrg(
  organizationId: string,
): Promise<ResolvedAiPrompt> {
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, ai_template_id, enabled_ai_features')
    .eq('id', organizationId)
    .single<{
      id:                  string
      ai_template_id:      string | null
      enabled_ai_features: Record<string, boolean> | null
    }>()

  if (!org || !org.ai_template_id) {
    return {
      organization_id: organizationId,
      template:        null,
      features:        [],
      enabled:         {},
      prompt:          '',
    }
  }

  const { data: template } = await supabase
    .from('ai_templates')
    .select('id, name, industry, base_prompt, metadata')
    .eq('id', org.ai_template_id)
    .single<AiTemplate>()

  if (!template) {
    return {
      organization_id: organizationId,
      template:        null,
      features:        [],
      enabled:         {},
      prompt:          '',
    }
  }

  const features = getTemplateFeatures(template)
  const enabled  = resolveEnabledFeatures(template, org.enabled_ai_features)
  const prompt   = applyFeatureGating(template.base_prompt, features, enabled)

  return {
    organization_id: organizationId,
    template,
    features,
    enabled,
    prompt,
  }
}
