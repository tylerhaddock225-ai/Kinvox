import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Customer } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import NewCustomerModal from '@/components/NewCustomerModal'
import CustomerRow from './CustomerRow'
import CustomersFilters from './CustomersFilters'

type CustomerRow = Pick<
  Customer,
  'id' | 'display_id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'company' | 'created_at' | 'lead_id'
>

type SearchParams = Promise<{ q?: string }>

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params   = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const q = params.q?.trim() ?? ''

  let query = supabase
    .from('customers')
    .select('id, display_id, first_name, last_name, email, phone, company, created_at, lead_id')
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (q) {
    // Strip characters that break Supabase's .or() grammar before interpolating.
    const safe = q.replace(/[%,()]/g, '')
    query = query.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
    )
  }

  const { data } = await query
  const rows = (data ?? []) as CustomerRow[]

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-sm text-gray-400 mt-1">People you support. Created automatically when leads are added, or add one manually.</p>
        </div>
        <NewCustomerModal />
      </div>

      <Suspense fallback={<div className="h-10" />}>
        <CustomersFilters />
      </Suspense>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {q
              ? 'No customers match your search.'
              : 'No customers yet. Create a lead and one will appear here.'}
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
              {rows.map(c => (
                <CustomerRow key={c.id} id={c.id}>
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={c.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-400">{c.email ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-400">{c.phone ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-400">{c.company ?? '—'}</td>
                  <td className="px-3 py-3 pr-6 text-gray-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                </CustomerRow>
              ))}
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
