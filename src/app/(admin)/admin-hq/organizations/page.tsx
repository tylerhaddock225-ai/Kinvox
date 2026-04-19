import { Suspense } from 'react'
import Link from 'next/link'
import { Eye, Archive } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { startImpersonation } from '@/app/actions/impersonation'
import CopyId from '@/components/CopyId'
import OrgFilters from './OrgFilters'

export const dynamic = 'force-dynamic'

type Row = {
  id:         string
  display_id: string | null
  name:       string
  vertical:   string | null
  status:     string | null
  deleted_at: string | null
  created_at: string
}

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string }>
}) {
  const { show, q: rawQ } = await searchParams
  const showArchived = show === 'all'
  const q = rawQ?.trim() ?? ''

  const supabase = await createClient()

  // Default: live merchants only. ?show=all includes archived rows.
  let baseQuery = supabase
    .from('organizations')
    .select('id, display_id, name, vertical, status, deleted_at, created_at')
    .order('created_at', { ascending: false })

  if (q) {
    // Strip characters that break Supabase's .or() grammar before interpolating.
    const safe = q.replace(/[%,()]/g, '')
    baseQuery = baseQuery.or(`name.ilike.%${safe}%,vertical.ilike.%${safe}%`)
  }

  const [{ data: orgs, error }, { count: archivedCount }] = await Promise.all([
    (showArchived ? baseQuery : baseQuery.is('deleted_at', null)).returns<Row[]>(),
    supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ])

  const rows = orgs ?? []
  const liveCount = rows.filter(r => !r.deleted_at).length
  const archived = archivedCount ?? 0

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Organizations</h1>
          <p className="mt-1 text-sm text-gray-400">
            {showArchived
              ? 'All organizations on the Kinvox platform, including archived.'
              : 'Live organizations on the Kinvox platform.'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <div className="font-medium text-gray-400">
            {showArchived
              ? <><span className="text-white">{rows.length}</span> total · <span className="text-gray-500">{liveCount} live</span></>
              : <><span className="text-white">{liveCount}</span> live</>
            }
          </div>
          {archived > 0 && (
            <Link
              href={showArchived ? '/admin-hq/organizations' : '/admin-hq/organizations?show=all'}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-300 hover:text-violet-200 transition-colors"
            >
              <Archive className="w-3 h-3" />
              {showArchived ? 'Hide archived' : `Show archived (${archived})`}
            </Link>
          )}
        </div>
      </header>

      <Suspense fallback={<div className="h-10" />}>
        <OrgFilters />
      </Suspense>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load organizations: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3 w-32">ID</th>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Vertical</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {rows.length ? (
              rows.map((org) => {
                const archivedRow = !!org.deleted_at
                const status = (org.status ?? 'active').toLowerCase()
                const isActive = !archivedRow && status === 'active'
                return (
                  <tr
                    key={org.id}
                    className={`transition-colors ${
                      archivedRow
                        ? 'opacity-60 hover:bg-white/[0.02]'
                        : 'hover:bg-violet-400/[0.05]'
                    }`}
                  >
                    <td className="px-5 py-4 text-xs">
                      <CopyId id={org.display_id} />
                    </td>
                    <td className="px-5 py-4 font-medium text-gray-100">{org.name}</td>
                    <td className="px-5 py-4 text-gray-300">
                      {org.vertical ?? <span className="text-gray-500">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {archivedRow ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-pvx-border bg-pvx-surface px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                          <Archive className="w-2.5 h-2.5" />
                          Archived
                        </span>
                      ) : (
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
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {!archivedRow && (
                          <form action={startImpersonation}>
                            <input type="hidden" name="orgId" value={org.id} />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 hover:text-violet-100 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View as Organization
                            </button>
                          </form>
                        )}
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
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-500">
                  {q
                    ? 'No organizations match your search.'
                    : showArchived ? 'No organizations yet.' : 'No live organizations.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
