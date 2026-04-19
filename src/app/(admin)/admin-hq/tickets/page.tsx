import Link from 'next/link'
import { LifeBuoy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type TicketStatus = 'open' | 'pending' | 'closed'
type HQCategory   = 'bug' | 'billing' | 'feature_request' | 'question'
type Scope        = 'all' | 'merchant' | 'platform'

const STATUS_STYLE: Record<TicketStatus, string> = {
  open:    'border-amber-700/60 bg-amber-950/40 text-amber-300',
  pending: 'border-sky-700/60 bg-sky-950/40 text-sky-300',
  closed:  'border-pvx-border bg-pvx-surface text-gray-400',
}

const CATEGORY_LABEL: Record<HQCategory, string> = {
  bug:              'Bug',
  billing:          'Billing',
  feature_request:  'Feature',
  question:         'Question',
}

const CATEGORY_STYLE: Record<HQCategory, string> = {
  bug:              'border-rose-700/60 bg-rose-950/40 text-rose-300',
  billing:          'border-emerald-700/60 bg-emerald-950/40 text-emerald-300',
  feature_request:  'border-violet-700/60 bg-violet-950/40 text-violet-300',
  question:         'border-sky-700/60 bg-sky-950/40 text-sky-300',
}

function ScopeTab({ scope, current, count, label }: {
  scope:   Scope
  current: Scope
  count:   number
  label:   string
}) {
  const href = scope === 'all' ? '/admin-hq/tickets' : `/admin-hq/tickets?scope=${scope}`
  const isActive = current === scope
  return (
    <Link
      href={href}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        isActive
          ? 'border-violet-500 text-white'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
      <span className="ml-1.5 text-xs text-gray-500">({count})</span>
    </Link>
  )
}

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>
}) {
  const supabase = await createClient()

  const params = await searchParams
  const scope: Scope =
    params.scope === 'platform' ? 'platform'
    : params.scope === 'merchant' ? 'merchant'
    : 'all'

  // Main listing query — narrowed by scope. RLS (is_admin_hq()) lets an
  // HQ admin see every row across orgs; the FK join pulls merchant name.
  let listingQ = supabase
    .from('tickets')
    .select('id, subject, status, created_at, organization_id, is_platform_support, hq_category, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (scope === 'platform') listingQ = listingQ.eq('is_platform_support', true)
  if (scope === 'merchant') listingQ = listingQ.eq('is_platform_support', false)

  const [listingRes, allCountRes, merchantCountRes, platformCountRes] = await Promise.all([
    listingQ.returns<
      Array<{
        id:                   string
        subject:              string
        status:               TicketStatus
        created_at:           string
        organization_id:      string
        is_platform_support:  boolean
        hq_category:          HQCategory | null
        organizations:        { name: string } | null
      }>
    >(),
    supabase.from('tickets').select('id', { count: 'exact', head: true }),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('is_platform_support', false),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('is_platform_support', true),
  ])

  const tickets = listingRes.data
  const error   = listingRes.error

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Global Queue
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">Tickets</h1>
          <p className="mt-1 text-sm text-gray-400">
            {scope === 'platform'
              ? 'Support requests from merchants to Kinvox HQ.'
              : scope === 'merchant'
                ? 'Every merchant\u2019s own customer tickets. Showing the 200 most recent.'
                : 'Every ticket across every merchant. Showing the 200 most recent.'}
          </p>
        </div>
        <div className="text-xs font-medium text-gray-400">
          {tickets?.length ?? 0} shown
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-pvx-border">
        <ScopeTab scope="all"      current={scope} count={allCountRes.count      ?? 0} label="All" />
        <ScopeTab scope="merchant" current={scope} count={merchantCountRes.count ?? 0} label="Merchant" />
        <ScopeTab scope="platform" current={scope} count={platformCountRes.count ?? 0} label="Platform Support" />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load tickets: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Organization</th>
              <th className="px-5 py-3">Subject</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {tickets?.length ? (
              tickets.map((t) => (
                <tr key={t.id} className="hover:bg-violet-400/[0.05] transition-colors">
                  <td className="px-5 py-4 text-gray-100 font-medium">
                    {t.organizations?.name ?? <span className="text-gray-500">Unknown</span>}
                  </td>
                  <td className="px-5 py-4 text-gray-300 truncate max-w-md">
                    <span className="inline-flex items-center gap-2">
                      {t.is_platform_support && (
                        <LifeBuoy className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-label="Platform support" />
                      )}
                      {t.subject}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {t.is_platform_support && t.hq_category ? (
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${CATEGORY_STYLE[t.hq_category]}`}
                      >
                        {CATEGORY_LABEL[t.hq_category]}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_STYLE[t.status]}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right text-xs text-gray-500 font-mono">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-500">
                  {scope === 'platform'
                    ? 'No platform-support tickets yet.'
                    : 'No tickets across the platform yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
