import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import type { Lead } from '@/lib/types/database.types'
import CreateLeadModal from '@/components/CreateLeadModal'
import CopyId from '@/components/CopyId'
import SortableHeader from '@/components/SortableHeader'
import LeadsFilters from './LeadsFilters'
import LeadRow from './LeadRow'

const STATUS_COLORS: Record<Lead['status'], string> = {
  new:            'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  qualified:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  lost:           'bg-red-500/10 text-red-400 border-red-500/20',
  converted:      'bg-purple-500/10 text-purple-400 border-purple-500/20',
  // pending_unlock is a legacy enum value from Sprint 2's lead-paywall flow.
  // No active path produces it after the Sprint 3 pivot, but the constraint
  // value is retained so existing rows (if any) still render with sensible
  // styling rather than a missing-key crash.
  pending_unlock: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
}

// Allowed sort keys → DB column + preferred default direction. `status` has
// no db column because alphabetical sort isn't useful; it's ranked in JS
// after the fetch via STATUS_RANK below. The `id` key sorts on `created_at`
// because display_id is text ('ld_2' < 'ld_10' lexicographically) — visual
// order matches creation order regardless.
const SORT_COLUMNS = {
  id:                    { db: 'created_at',            defaultOrder: 'desc' as const },
  name:                  { db: 'first_name',            defaultOrder: 'asc'  as const },
  email:                 { db: 'email',                 defaultOrder: 'asc'  as const },
  status:                { db: null,                    defaultOrder: 'asc'  as const },
  created_at:            { db: 'created_at',            defaultOrder: 'desc' as const },
  updated_at:            { db: 'updated_at',            defaultOrder: 'desc' as const },
  last_lead_activity_at: { db: 'last_lead_activity_at', defaultOrder: 'desc' as const },
} as const

const STATUS_RANK: Record<Lead['status'], number> = {
  new:            0,
  contacted:      1,
  qualified:      2,
  pending_unlock: 3,
  converted:      4,
  lost:           5,
}

type SearchParams = Promise<{
  q?:      string
  status?: string
  source?: string
  view?:   string
  sort?:   string
  order?:  string
}>

type LeadView = 'active' | 'archived'

function pickView(v: string | undefined): LeadView {
  return v === 'archived' ? 'archived' : 'active'
}

// Tab affordance for Active | Archived. Preserves q/status/source/sort/order
// across switches; drops the `view` key so the default (active) URL stays clean.
function ViewTab({
  view, current, label, orgSlug, params,
}: {
  view:    LeadView
  current: LeadView
  label:   string
  orgSlug: string
  params:  Record<string, string | undefined>
}) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    if (k === 'view') continue
    next.set(k, v)
  }
  if (view !== 'active') next.set('view', view)
  const href = `/${orgSlug}/leads${next.toString() ? `?${next.toString()}` : ''}`
  const isActive = current === view
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
    </Link>
  )
}

type RouteParams = Promise<{ orgSlug: string }>

function pickStatus(v: string | undefined): Lead['status'] | null {
  if (!v) return null
  const allowed: Lead['status'][] = ['new', 'contacted', 'qualified', 'lost', 'converted']
  return (allowed as string[]).includes(v) ? (v as Lead['status']) : null
}

function pickSource(v: string | undefined): NonNullable<Lead['source']> | null {
  if (!v) return null
  const allowed: NonNullable<Lead['source']>[] = ['web', 'referral', 'import', 'manual', 'other']
  return (allowed as string[]).includes(v) ? (v as NonNullable<Lead['source']>) : null
}

type LeadListRow = Pick<
  Lead,
  | 'id'
  | 'display_id'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'company'
  | 'status'
  | 'source'
  | 'created_at'
  | 'updated_at'
  | 'last_lead_activity_at'
  | 'archived_at'
>

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params:       RouteParams
  searchParams: SearchParams
}) {
  const { orgSlug } = await params
  const sp          = await searchParams
  const supabase    = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single<{ organization_id: string | null }>(),
    resolveImpersonation(),
  ])

  // HQ admins have no tenant org (profile.organization_id is null). When
  // they're impersonating, we scope to the impersonated org; otherwise
  // we require a tenant org and bounce to /onboarding.
  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  const q      = sp.q?.trim() ?? ''
  const status = pickStatus(sp.status)
  const source = pickSource(sp.source)
  const view   = pickView(sp.view)

  // Sort: validate against the allowed-keys list. The `hasExplicitSort` flag
  // controls whether the archived branch keeps its archived_at desc default
  // (no explicit sort) or honours the user's chosen column (explicit sort).
  const rawSort         = typeof sp.sort === 'string' ? sp.sort : null
  const hasExplicitSort = rawSort !== null && rawSort in SORT_COLUMNS
  const sortKey         = (hasExplicitSort ? rawSort : 'updated_at') as keyof typeof SORT_COLUMNS
  const rawOrder        = typeof sp.order === 'string' ? sp.order : null
  const order: 'asc' | 'desc' = rawOrder === 'asc' || rawOrder === 'desc'
    ? rawOrder
    : SORT_COLUMNS[sortKey].defaultOrder

  let query = supabase
    .from('leads')
    .select('id, display_id, first_name, last_name, email, company, status, source, created_at, updated_at, last_lead_activity_at, archived_at')
    .eq('organization_id', effectiveOrgId)
    .is('deleted_at', null)
    .limit(200)

  if (view === 'archived') {
    query = query.not('archived_at', 'is', null)
    if (hasExplicitSort) {
      if (SORT_COLUMNS[sortKey].db) {
        query = query.order(SORT_COLUMNS[sortKey].db!, { ascending: order === 'asc', nullsFirst: false })
      } else {
        // JS-sorted column — fetch with a stable secondary order.
        query = query.order('updated_at', { ascending: false })
      }
    } else {
      query = query.order('archived_at', { ascending: false })
    }
  } else {
    query = query.is('archived_at', null)
    if (SORT_COLUMNS[sortKey].db) {
      query = query.order(SORT_COLUMNS[sortKey].db!, { ascending: order === 'asc', nullsFirst: false })
    } else {
      // JS-sorted column — fetch with a stable secondary order.
      query = query.order('updated_at', { ascending: false })
    }
  }

  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (q) {
    const safe = q.replace(/[%,()]/g, '')
    query = query.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
    )
  }

  const { data: leads } = await query
  let rows = (leads ?? []) as LeadListRow[]

  // JS sort for columns whose DB column is null (status uses a workflow-
  // progression rank rather than alphabetical).
  if (sortKey === 'status') {
    rows = [...rows].sort((a, b) => {
      const diff = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99)
      return order === 'asc' ? diff : -diff
    })
  }

  // Per-user "last viewed" lookup for the activity-badge column. Empty if
  // no leads were fetched (avoids a no-op IN() round trip).
  const viewMap = new Map<string, string>()
  if (rows.length > 0) {
    const { data: views } = await supabase
      .from('lead_views')
      .select('lead_id, last_viewed_at')
      .eq('user_id', user.id)
      .in('lead_id', rows.map(l => l.id))
    for (const v of views ?? []) viewMap.set(v.lead_id, v.last_viewed_at)
  }

  function hasUnreadActivity(lead: LeadListRow): boolean {
    if (!lead.last_lead_activity_at) return false
    const lastViewed = viewMap.get(lead.id)
    if (!lastViewed) return true
    // Parse to Date — last_lead_activity_at can be microsecond-precision
    // (when backfilled from lead_messages.created_at at migration time) or
    // millisecond-precision (from JS writes). Lexicographic string > on
    // these mixed formats is unreliable. new Date() truncates to ms but
    // preserves the ordering we care about for the badge.
    return new Date(lead.last_lead_activity_at).getTime() > new Date(lastViewed).getTime()
  }

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Leads</h1>
          <p className="text-sm text-gray-400 mt-1">Manage and track your sales leads.</p>
        </div>
        <CreateLeadModal />
      </div>

      <div className="flex items-center gap-1 border-b border-pvx-border">
        <ViewTab view="active"   current={view} label="Active"   orgSlug={orgSlug} params={sp} />
        <ViewTab view="archived" current={view} label="Archived" orgSlug={orgSlug} params={sp} />
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <LeadsFilters />
      </Suspense>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-x-auto">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {q || status || source
              ? 'No leads match your filters.'
              : view === 'archived'
                ? 'No archived leads.'
                : 'No leads yet. Add your first lead to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">
                  <SortableHeader label="ID" sortKey="id" defaultOrder="desc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Name" sortKey="name" defaultOrder="asc" />
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-left font-medium">
                  <SortableHeader label="Email" sortKey="email" defaultOrder="asc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Status" sortKey="status" defaultOrder="asc" />
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-left font-medium">
                  <SortableHeader label="Created" sortKey="created_at" defaultOrder="desc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Updated" sortKey="updated_at" defaultOrder="desc" />
                </th>
                <th className="px-3 py-3 pr-6 text-left font-medium">
                  <SortableHeader label="Activity" sortKey="last_lead_activity_at" defaultOrder="desc" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(lead => (
                <LeadRow key={lead.id} orgSlug={orgSlug} id={lead.id}>
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={lead.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium">
                    {lead.first_name} {lead.last_name ?? ''}
                  </td>
                  <td className="hidden md:table-cell px-3 py-3 text-gray-400">{lead.email ?? '—'}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[lead.status]}`}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="hidden md:table-cell px-3 py-3 text-gray-500">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3 text-gray-500">
                    {new Date(lead.updated_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-3 pr-6">
                    {hasUnreadActivity(lead) && (
                      <span
                        className="inline-block w-2 h-2 rounded-full bg-violet-500"
                        aria-label="Unread activity"
                      />
                    )}
                  </td>
                </LeadRow>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-gray-500">Showing {rows.length} lead{rows.length === 1 ? '' : 's'}.</p>
      )}
    </div>
  )
}
