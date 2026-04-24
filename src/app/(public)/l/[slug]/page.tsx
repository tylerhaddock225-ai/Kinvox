import { notFound } from 'next/navigation'
import { Check, ExternalLink } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import LeadCaptureLandingForm from './LeadCaptureLandingForm'
import { normalizeLeadQuestions } from '@/lib/lead-questions'

export const dynamic = 'force-dynamic'

type Settings = {
  enabled?:  boolean
  headline?: string
  features?: string[]
}

type Org = {
  id:                    string
  name:                  string
  lead_magnet_slug:      string | null
  lead_magnet_settings:  Settings | null
  website_url:           string | null
  custom_lead_questions: unknown
}

// If the merchant opted into a feature that resembles a grant screener,
// show the homestead-exemption question on the capture form. Matching on
// the label keeps the landing page self-contained — no coupling to the
// AI-template feature keys, since merchants can also type bespoke strings
// into the feature list.
function needsHomesteadQuestion(features: string[] | undefined): boolean {
  if (!features?.length) return false
  return features.some((f) => /grant|homestead|soh/i.test(f))
}

export default async function LeadMagnetPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!slug) notFound()

  // Admin client bypasses RLS: we want this page readable anonymously
  // without widening the organizations table's RLS policies. The query
  // still enforces the "enabled" + "not archived" invariants so a
  // disabled slug 404s the same as a missing one.
  const supabase = createAdminClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, lead_magnet_slug, lead_magnet_settings, website_url, custom_lead_questions')
    .ilike('lead_magnet_slug', slug)
    .is('deleted_at', null)
    .single<Org>()

  if (!org) notFound()

  const settings = org.lead_magnet_settings ?? {}
  if (!settings.enabled || !org.lead_magnet_slug) notFound()

  const headline = settings.headline || 'Check your eligibility'
  const features = Array.isArray(settings.features) ? settings.features : []
  const askHomestead = needsHomesteadQuestion(features)
  const customQuestions = normalizeLeadQuestions(org.custom_lead_questions)

  return (
    <main className="px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-md">
        <header className="text-center">
          <div className="text-[10px] font-bold tracking-[0.25em] text-emerald-400 uppercase">
            {org.name}
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-white leading-tight">
            {headline}
          </h1>
        </header>

        {features.length > 0 && (
          <ul className="mt-6 space-y-2.5">
            {features.map((f, i) => (
              <li key={`${f}-${i}`} className="flex items-start gap-2.5 text-sm text-gray-200">
                <span className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">
                  <Check className="w-3 h-3" />
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 rounded-2xl border border-pvx-border bg-gray-900/80 p-5 shadow-xl backdrop-blur">
          <LeadCaptureLandingForm
            slug={org.lead_magnet_slug}
            askHomestead={askHomestead}
            customQuestions={customQuestions}
          />
        </div>

        {org.website_url && (
          <div className="mt-6 text-center">
            <a
              href={org.website_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
            >
              Learn more about {org.name}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        <footer className="mt-10 text-center text-[10px] text-gray-600">
          Powered by Kinvox
        </footer>
      </div>
    </main>
  )
}
