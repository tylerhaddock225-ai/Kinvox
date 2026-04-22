import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Archive } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import type { Customer } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import NewCustomerModal from '@/components/NewCustomerModal'
import CustomerRow from './CustomerRow'
import CustomersFilters from './CustomersFilters'

type CustomerRow = Pick<
  Customer,
  'id' | 'display_id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'company' | 'created_at' | 'lead_id' | 'archived_at'
>

type SearchParams = Promise<{ q?: string; show?: string }>

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
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

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  const q = params.q?.trim() ?? ''
  const showArchived = params.show === 'all'

  let query = supabase
    .from('customers')
    .select('id, display_id, first_name, last_name, email, phone, company, created_at, lead_id, archived_at')
    .eq('organization_id', effectiveOrgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  // archived_at stays filtered unless the merchant explicitly flips
  // "Show archived" \u2014 deleted_at remains always-filtered regardless.
  if (!showArchived) query = query.is('archived_at', null)

  if (q) {
    // Strip characters that break Supabase's .or() grammar before interpolating.
    const safe = q.replace(/[%,()]/g, '')
    query = query.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
    )
  }

  // Second round-trip: count of archived rows for the footer link label.
  const [{ data }, { count: archivedCount }] = await Promise.all([
    query,
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', effectiveOrgId)
      .is('deleted_at', null)
      .not('archived_at', 'is', null),
  ])

  const rows = (data ?? []) as CustomerRow[]
  const archived = archivedCount ?? 0

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-sm text-gray-400 mt-1">People you support. Created when a lead is converted, or add one manually.</p>
        </div>
        <NewCustomerModal />
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <CustomersFilters />
      </Suspense>

      {archived > 0 && (
        <div className="text-xs">
          <Link
            href={showArchived ? '/customers' : '/customers?show=all'}
            className="inline-flex items-center gap-1.5 font-medium text-violet-300 hover:text-violet-200 transition-colors"
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Hide archived' : `Show archived (${archived})`}
          </Link>
        </div>
      )}

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {q
              ? 'No customers match your search.'
              : showArchived
                ? 'No customers in archive.'
                : 'No customers yet. Convert a lead or add one manually.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                <th className="px-3 py-3 text-left font-medium">Name</th>
                <th className="px-3 py-3 text-left font-medium">Email</th>
                <th className="px-3 py-3 text-left font-medium">Phone</th>
                <th className="px-3 py-3 text-left font-medium">Company</th>
                <th className="px-3 py-3 pr-6 text-left font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(c => {
                const archivedRow = !!c.archived_at
                return (
                  <CustomerRow key={c.id} id={c.id}>
                    <td className={`pl-6 pr-3 py-3 text-xs ${archivedRow ? 'opacity-60' : ''}`}>
                      <CopyId id={c.display_id} />
                    </td>
                    <td className={`px-3 py-3 text-gray-200 font-medium ${archivedRow ? 'opacity-60' : ''}`}>
                      <span className="inline-flex items-center gap-2">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || '\u2014'}
                        {archivedRow && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-pvx-border bg-pvx-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            <Archive className="w-2.5 h-2.5" />
                            Archived
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`px-3 py-3 text-gray-400 ${archivedRow ? 'opacity-60' : ''}`}>{c.email ?? '\u2014'}</td>
                    <td className={`px-3 py-3 text-gray-400 ${archivedRow ? 'opacity-60' : ''}`}>{c.phone ?? '\u2014'}</td>
                    <td className={`px-3 py-3 text-gray-400 ${archivedRow ? 'opacity-60' : ''}`}>{c.company ?? '\u2014'}</td>
                    <td className={`px-3 py-3 pr-6 text-gray-500 ${archivedRow ? 'opacity-60' : ''}`}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </CustomerRow>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-gray-500">Showing {rows.length} customer{rows.length === 1 ? '' : 's'}.</p>
      )}
    </div>
  )
}
