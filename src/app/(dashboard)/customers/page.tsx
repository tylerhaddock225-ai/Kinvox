import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Customer } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import CustomerRow from './CustomerRow'

type CustomerRow = Pick<
  Customer,
  'id' | 'display_id' | 'first_name' | 'last_name' | 'email' | 'phone' | 'company' | 'created_at' | 'lead_id'
>

export default async function CustomersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const { data } = await supabase
    .from('customers')
    .select('id, display_id, first_name, last_name, email, phone, company, created_at, lead_id')
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const rows = (data ?? []) as CustomerRow[]

  return (
    <div className="px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Customers</h1>
        <p className="text-sm text-gray-400 mt-1">People you support. Created automatically when leads are added.</p>
      </div>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            No customers yet. Create a lead and one will appear here.
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
