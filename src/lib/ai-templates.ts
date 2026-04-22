// Shape of a feature defined inside an ai_templates.metadata jsonb blob.
// The HQ "Feature Library" view, the merchant toggle UI, and any future
// runtime that asks "is feature X enabled for org Y?" all read from this
// shape — keep changes here in lockstep with the seed migration.
export type AiTemplateFeature = {
  key:              string
  name:             string
  description:      string
  default_enabled:  boolean
}

export type AiTemplateMetadata = {
  cycle?:    string
  features?: AiTemplateFeature[]
}

export type AiTemplate = {
  id:          string
  name:        string
  industry:    string
  base_prompt: string
  metadata:    AiTemplateMetadata
  created_at?: string
  updated_at?: string
}

export function getTemplateFeatures(t: Pick<AiTemplate, 'metadata'>): AiTemplateFeature[] {
  return Array.isArray(t.metadata?.features) ? t.metadata.features! : []
}

// Merge a template's feature list with a merchant's toggle state. Unknown
// keys in `enabled` are dropped (template owns the catalogue), and any
// feature missing from `enabled` falls back to its default_enabled flag.
export function resolveEnabledFeatures(
  template: Pick<AiTemplate, 'metadata'> | null,
  enabled:  Record<string, boolean> | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const f of getTemplateFeatures(template ?? { metadata: {} })) {
    out[f.key] = enabled && f.key in enabled ? !!enabled[f.key] : f.default_enabled
  }
  return out
}
