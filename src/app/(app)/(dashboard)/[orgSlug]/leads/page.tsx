import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import type { Lead } from '@/lib/types/database.types'
import CreateLeadModal from '@/components/CreateLeadModal'
import CopyId from '@/components/CopyId'
import LeadsFilters from './LeadsFilters'
import LeadRow from './LeadRow'
import UnlockButton from './UnlockButton'

const STATUS_COLORS: Record<Lead['status'], string> = {
  new:            'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  qualified:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  lost:           'bg-red-500/10 text-red-400 border-red-500/20',
  converted:      'bg-purple-500/10 text-purple-400 border-purple-500/20',
  pending_unlock: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
}

const STATUS_LABEL: Record<Lead['status'], string> = {
  new:            'new',
  contacted:      'contacted',
  qualified:      'qualified',
  lost:           'lost',
  converted:      'converted',
  pending_unlock: 'locked',
}

type SearchParams = Promise<{
  q?:      string
  status?: string
  source?: string
}>

type LeadMetadata = {
  geofence?:       string
  distance_miles?: number
  teaser_snippet?: string
}

function pickStatus(v: string | undefined): Lead['status'] | null {
  if (!v) return null
  const allowed: Lead['status'][] = ['new', 'contacted', 'qualified', 'lost', 'converted', 'pending_unlock']
  return (allowed as string[]).includes(v) ? (v as Lead['status']) : null
}

function pickSource(v: string | undefined): NonNullable<Lead['source']> | null {
  if (!v) return null
  const allowed: NonNullable<Lead['source']>[] = ['web', 'referral', 'import', 'manual', 'other']
  return (allowed as string[]).includes(v) ? (v as NonNullable<Lead['source']>) : null
}

function readMeta(meta: Lead['metadata']): LeadMetadata {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const m = meta as Record<string, unknown>
  return {
    geofence:       typeof m.geofence       === 'string' ? m.geofence       : undefined,
    distance_miles: typeof m.distance_miles === 'number' ? m.distance_miles : undefined,
    teaser_snippet: typeof m.teaser_snippet === 'string' ? m.teaser_snippet : undefined,
  }
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const params   = await searchParams
  const supabase = await createClient()

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

  const q      = params.q?.trim() ?? ''
  const status = pickStatus(params.status)
  const source = pickSource(params.source)

  let query = supabase
    .from('leads')
    .select('id, display_id, first_name, last_name, email, company, status, source, created_at, metadata')
    .eq('organization_id', effectiveOrgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (q) {
    const safe = q.replace(/[%,()]/g, '')
    query = query.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
    )
  }

  const { data: leads } = await query
  const rows = (leads ?? []) as Pick<Lead, 'id' | 'display_id' | 'first_name' | 'last_name' | 'email' | 'company' | 'status' | 'source' | 'created_at' | 'metadata'>[]

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Leads</h1>
          <p className="text-sm text-gray-400 mt-1">Manage and track your sales leads.</p>
        </div>
        <CreateLeadModal />
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <LeadsFilters />
      </Suspense>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {q || status || source
              ? 'No leads match your filters.'
              : 'No leads yet. Add your first lead to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                <th className="px-3 py-3 text-left font-medium">Name</th>
                <th className="px-3 py-3 text-left font-medium">Company</th>
                <th className="px-3 py-3 text-left font-medium">Email</th>
                <th className="px-3 py-3 text-left font-medium">Source</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 pr-6 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(lead => {
                const isLocked = lead.status === 'pending_unlock'
                const meta     = readMeta(lead.metadata)
                const cells = (
                  <>
                    <td className="pl-6 pr-3 py-3 text-xs">
                      <CopyId id={lead.display_id} />
                    </td>
                    <td className="px-3 py-3">
                      {isLocked ? (
                        <UnlockButton leadId={lead.id} />
                      ) : (
                        <span className="text-gray-200 font-medium">
                          {lead.first_name} {lead.last_name ?? ''}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-400">
                      {isLocked ? <Redacted /> : (lead.company ?? '—')}
                    </td>
                    <td className="px-3 py-3 text-gray-400">
                      {isLocked ? <Redacted /> : (lead.email ?? '—')}
                    </td>
                    <td className="px-3 py-3 text-gray-400 capitalize">
                      {isLocked ? (
                        <GeofenceBadge meta={meta} />
                      ) : (
                        lead.source ?? '—'
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[lead.status]}`}>
                        {STATUS_LABEL[lead.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 pr-6 text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                  </>
                )
                if (isLocked) {
                  return (
                    <tr key={lead.id} className="bg-violet-950/10">
                      {cells}
                    </tr>
                  )
                }
                return (
                  <LeadRow key={lead.id} id={lead.id}>
                    {cells}
                  </LeadRow>
                )
              })}
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

function Redacted() {
  return (
    <span className="inline-block rounded bg-pvx-border/60 px-3 py-1 text-[10px] tracking-widest text-gray-500 select-none">
      • • • • •
    </span>
  )
}

function GeofenceBadge({ meta }: { meta: LeadMetadata }) {
  const inside = meta.geofence === 'inside'
  const dist   = typeof meta.distance_miles === 'number' ? meta.distance_miles : null

  const cls = inside
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200'

  const label = dist !== null
    ? `${dist.toFixed(1)} mi away`
    : (inside ? 'In service area' : 'Outside service area')

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium normal-case ${cls}`}>
      <MapPin className="w-3 h-3" />
      {label}
      {meta.teaser_snippet && (
        <span className="ml-1.5 text-[10px] text-gray-400/90 italic">
          “{meta.teaser_snippet}…”
        </span>
      )}
    </span>
  )
}
