import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminOrganizationsPage() {
  const supabase = await createClient()

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, vertical, status, deleted_at, created_at')
    .order('created_at', { ascending: false })
    .returns<
      Array<{
        id: string
        name: string
        vertical: string | null
        status: string | null
        deleted_at: string | null
        created_at: string
      }>
    >()

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Organizations</h1>
          <p className="mt-1 text-sm text-slate-400">
            All merchants on the Kinvox platform.
          </p>
        </div>
        <div className="text-xs font-medium text-slate-400">
          {orgs?.length ?? 0} total
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load organizations: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 border-b border-slate-800">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Vertical</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {orgs?.length ? (
              orgs.map((org) => {
                const status = (org.status ?? 'active').toLowerCase()
                const isActive = status === 'active'
                return (
                  <tr key={org.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-5 py-4 font-medium text-slate-100">{org.name}</td>
                    <td className="px-5 py-4 text-slate-300">
                      {org.vertical ?? <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                          isActive
                            ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                            : 'border-slate-700 bg-slate-800/60 text-slate-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isActive ? 'bg-emerald-400' : 'bg-slate-500'
                          }`}
                        />
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/admin-hq/organizations/${org.id}`}
                        className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-500">
                  No organizations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
