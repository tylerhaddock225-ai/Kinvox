import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import type { Lead } from '@/lib/types/database.types'
import CreateLeadModal from '@/components/CreateLeadModal'
import CopyId from '@/components/CopyId'
import LeadsFilters from './LeadsFilters'
import LeadRow from './LeadRow'

const STATUS_COLORS: Record<Lead['status'], string> = {
  new:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  qualified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  lost:      'bg-red-500/10 text-red-400 border-red-500/20',
  converted: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
}

type SearchParams = Promise<{
  q?:      string
  status?: string
  source?: string
}>

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
    .select('id, display_id, first_name, last_name, email, company, status, source, created_at')
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
  const rows = (leads ?? []) as Pick<Lead, 'id' | 'display_id' | 'first_name' | 'last_name' | 'email' | 'company' | 'status' | 'source' | 'created_at'>[]

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
              {rows.map(lead => (
                <LeadRow key={lead.id} id={lead.id}>
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={lead.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium">
                    {lead.first_name} {lead.last_name ?? ''}
                  </td>
                  <td className="px-3 py-3 text-gray-400">{lead.company ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-400">{lead.email ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-400 capitalize">{lead.source ?? '—'}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[lead.status]}`}>
                      {lead.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 pr-6 text-gray-500">
                    {new Date(lead.created_at).toLocaleDateString()}
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
