import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Sparkles, ToggleRight, ToggleLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getTemplateFeatures, type AiTemplate } from '@/lib/ai-templates'

export const dynamic = 'force-dynamic'

export default async function AdminAiTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: template } = await supabase
    .from('ai_templates')
    .select('id, name, industry, base_prompt, metadata, created_at, updated_at')
    .eq('id', id)
    .single<AiTemplate>()

  if (!template) notFound()

  const features = getTemplateFeatures(template)

  // Cross-reference: how many merchants are running this template right
  // now? Useful before editing the prompt — count is a "blast radius" hint.
  const { count: adoptionCount } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .eq('ai_template_id', template.id)
    .is('deleted_at', null)

  return (
    <div className="space-y-8 max-w-4xl">
      <Link
        href="/admin-hq/ai-templates"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All templates
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-violet-500/10 p-3 text-violet-300 ring-1 ring-inset ring-violet-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
              {template.industry}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">{template.name}</h1>
            <p className="mt-1 text-xs text-gray-500">
              {adoptionCount ?? 0} {adoptionCount === 1 ? 'organization' : 'organizations'} using this template
            </p>
          </div>
        </div>
      </header>

      {/* Base prompt */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-white">Base Prompt</h2>
        <p className="mt-1 text-xs text-gray-500">
          Sent on every conversation. Per-feature instructions are appended at runtime when the organization has the feature toggled on.
        </p>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-pvx-border bg-pvx-surface p-4 text-xs leading-relaxed text-gray-200 font-mono">
{template.base_prompt}
        </pre>
      </section>

      {/* Feature library */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Feature Library</h2>
            <p className="mt-1 text-xs text-gray-500">
              Modules organizations can toggle individually from their own settings.
            </p>
          </div>
          <span className="inline-flex items-center rounded-md border border-pvx-border bg-pvx-surface px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {features.length} {features.length === 1 ? 'feature' : 'features'}
          </span>
        </div>

        {features.length === 0 ? (
          <div className="mt-4 rounded-md border border-pvx-border bg-pvx-surface px-4 py-6 text-center text-xs text-gray-500">
            This template has no features defined.
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {features.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-3 rounded-lg border border-pvx-border bg-pvx-surface p-4"
              >
                <div className="mt-0.5 shrink-0">
                  {f.default_enabled ? (
                    <ToggleRight className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-gray-500" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{f.name}</h3>
                    <code className="rounded bg-pvx-bg px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
                      {f.key}
                    </code>
                    <span
                      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        f.default_enabled
                          ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                          : 'border-pvx-border bg-pvx-bg text-gray-400'
                      }`}
                    >
                      Default {f.default_enabled ? 'on' : 'off'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400 leading-relaxed">{f.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
