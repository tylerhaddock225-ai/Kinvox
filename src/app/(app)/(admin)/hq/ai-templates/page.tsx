import Link from 'next/link'
import { Sparkles, Plus, Layers } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getTemplateFeatures, type AiTemplate } from '@/lib/ai-templates'

export const dynamic = 'force-dynamic'

export default async function AdminAiTemplatesPage() {
  const supabase = await createClient()
  const { data: templates, error } = await supabase
    .from('ai_templates')
    .select('id, name, industry, base_prompt, metadata, created_at')
    .order('created_at', { ascending: false })
    .returns<AiTemplate[]>()

  const rows = templates ?? []

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Prompt Library
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">AI Templates</h1>
          <p className="mt-1 text-sm text-gray-400">
            Industry-specific prompts that organizations can adopt or fork.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 rounded-md border border-pvx-border bg-pvx-surface px-3 py-1.5 text-xs font-medium text-gray-500 cursor-not-allowed"
          title="Template authoring coming soon"
        >
          <Plus className="w-3.5 h-3.5" />
          New template
        </button>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load templates: {error.message}
        </div>
      )}

      {!error && rows.length === 0 && (
        <div className="rounded-md border border-pvx-border bg-gray-900 px-4 py-10 text-center text-sm text-gray-400">
          No templates yet. Run the latest migration to seed the Storm Shelter template.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((t) => {
          const features = getTemplateFeatures(t)
          return (
            <Link
              key={t.id}
              href={`/hq/ai-templates/${t.id}`}
              className="group block rounded-xl border border-pvx-border bg-gray-900 p-5 shadow-sm transition-all hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/15"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300 ring-1 ring-inset ring-violet-500/20">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="inline-flex items-center rounded-md border border-pvx-border bg-pvx-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  {t.industry}
                </span>
              </div>

              <h2 className="mt-4 text-base font-semibold text-white group-hover:text-violet-100 transition-colors">
                {t.name}
              </h2>
              <p className="mt-1 line-clamp-3 text-sm text-gray-400 leading-relaxed">
                {t.base_prompt.split('\n')[0]}
              </p>

              <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                <Layers className="w-3 h-3" />
                {features.length} {features.length === 1 ? 'feature' : 'features'}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
