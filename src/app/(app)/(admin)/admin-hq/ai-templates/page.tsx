import { Sparkles, FileText, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Placeholder seed — replace with a real `public.ai_templates` table
// once the schema is decided. Fields below mirror the likely shape so
// wiring the DB later is a drop-in.
type TemplateSeed = {
  id:       string
  name:     string
  vertical: string
  summary:  string
  tags:     string[]
}

const SEED: TemplateSeed[] = [
  {
    id: 'dental-intake',
    name: 'Dental new-patient intake',
    vertical: 'Dental',
    summary: 'Qualifies insurance, preferred hours, and prior-provider notes.',
    tags: ['intake', 'phone', 'sms'],
  },
  {
    id: 'home-prep-followup',
    name: 'Home Preparedness follow-up',
    vertical: 'Home Preparedness',
    summary: 'Re-engages a cold lead after a site assessment with seasonal hooks.',
    tags: ['follow-up', 'email'],
  },
  {
    id: 'payfac-underwriting',
    name: 'PayFac underwriting prompts',
    vertical: 'Payment Facilitation',
    summary: 'Asks for volume, MCC, and past processor history in plain language.',
    tags: ['underwriting', 'intake'],
  },
]

export default async function AdminAiTemplatesPage() {
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

      <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
        Library view only — backing table (<code className="font-mono">public.ai_templates</code>) not yet built.
        The seed entries below are placeholders.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {SEED.map((t) => (
          <article
            key={t.id}
            className="rounded-xl border border-pvx-border bg-gray-900 p-5 shadow-sm transition-all hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/15"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300 ring-1 ring-inset ring-violet-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="inline-flex items-center rounded-md border border-pvx-border bg-pvx-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                {t.vertical}
              </span>
            </div>

            <h2 className="mt-4 text-base font-semibold text-white">{t.name}</h2>
            <p className="mt-1 text-sm text-gray-400 leading-relaxed">{t.summary}</p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {t.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-pvx-surface border border-pvx-border px-1.5 py-0.5 text-[10px] font-medium text-gray-400"
                >
                  <FileText className="w-2.5 h-2.5" />
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
