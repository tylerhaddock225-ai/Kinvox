'use client'

import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { setOrgAiStrategy } from '@/app/(app)/(admin)/admin-hq/actions/ai-templates'
import {
  getTemplateFeatures,
  resolveEnabledFeatures,
  type AiTemplate,
} from '@/lib/ai-templates'

type Props = {
  orgId:           string
  templates:       AiTemplate[]
  currentTemplateId: string | null
  enabledFeatures: Record<string, boolean>
}

export default function OrgAiStrategyForm({
  orgId,
  templates,
  currentTemplateId,
  enabledFeatures,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(currentTemplateId ?? '')

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  )

  // When the user picks a different template the previous toggles are
  // meaningless (different feature catalogue), so we resolve from the
  // template's defaults. When they re-pick the original template we
  // restore their saved toggle state.
  const features = selected ? getTemplateFeatures(selected) : []
  const initialToggles = useMemo(() => {
    if (!selected) return {}
    if (selected.id === currentTemplateId) {
      return resolveEnabledFeatures(selected, enabledFeatures)
    }
    return resolveEnabledFeatures(selected, null)
  }, [selected, currentTemplateId, enabledFeatures])

  return (
    <form action={setOrgAiStrategy} className="space-y-5">
      <input type="hidden" name="org_id" value={orgId} />

      <label className="block">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
          Template
        </span>
        <select
          name="template_id"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        >
          <option value="">— No template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.industry})
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="rounded-lg border border-pvx-border bg-pvx-surface/60 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-300" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
              Feature toggles
            </h3>
          </div>

          {features.length === 0 ? (
            <p className="mt-3 text-xs text-gray-500">
              This template has no toggleable features.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {features.map((f) => (
                <li key={f.key} className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`feature_${f.key}`}
                    name={`feature_${f.key}`}
                    defaultChecked={!!initialToggles[f.key]}
                    className="mt-0.5 h-4 w-4 rounded border-pvx-border bg-pvx-bg text-violet-500 focus:ring-violet-500/40"
                  />
                  <label htmlFor={`feature_${f.key}`} className="flex-1 cursor-pointer">
                    <div className="text-sm font-medium text-gray-100">{f.name}</div>
                    <div className="mt-0.5 text-xs text-gray-400 leading-relaxed">
                      {f.description}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="pt-1">
        <button
          type="submit"
          className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          Save AI strategy
        </button>
      </div>
    </form>
  )
}
