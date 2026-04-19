import Link from 'next/link'
import { Eye } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { startImpersonation } from '@/app/actions/impersonation'

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
          <h1 className="text-2xl font-semibold text-white">Organizations</h1>
          <p className="mt-1 text-sm text-gray-400">
            All merchants on the Kinvox platform.
          </p>
        </div>
        <div className="text-xs font-medium text-gray-400">
          {orgs?.length ?? 0} total
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load organizations: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Vertical</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {orgs?.length ? (
              orgs.map((org) => {
                const status = (org.status ?? 'active').toLowerCase()
                const isActive = status === 'active'
                return (
                  <tr key={org.id} className="hover:bg-violet-400/[0.05] transition-colors">
                    <td className="px-5 py-4 font-medium text-gray-100">{org.name}</td>
                    <td className="px-5 py-4 text-gray-300">
                      {org.vertical ?? <span className="text-gray-500">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                          isActive
                            ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                            : 'border-pvx-border bg-pvx-surface text-gray-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            isActive ? 'bg-emerald-400' : 'bg-gray-500'
                          }`}
                        />
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <form action={startImpersonation}>
                          <input type="hidden" name="orgId" value={org.id} />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 hover:text-violet-100 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View as Merchant
                          </button>
                        </form>
                        <Link
                          href={`/admin-hq/organizations/${org.id}`}
                          className="inline-flex items-center rounded-md border border-pvx-border bg-pvx-surface px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-pvx-border hover:text-white transition-colors"
                        >
                          Manage
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-gray-500">
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
