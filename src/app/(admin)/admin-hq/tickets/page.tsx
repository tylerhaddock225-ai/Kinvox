import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type TicketStatus = 'open' | 'pending' | 'closed'

const STATUS_STYLE: Record<TicketStatus, string> = {
  open:    'border-amber-700/60 bg-amber-950/40 text-amber-300',
  pending: 'border-sky-700/60 bg-sky-950/40 text-sky-300',
  closed:  'border-pvx-border bg-pvx-surface text-gray-400',
}

export default async function AdminTicketsPage() {
  const supabase = await createClient()

  // is_admin_hq() + RLS SELECT policy on tickets already allows this
  // to return every row across orgs. The FK join to organizations
  // pulls merchant name in the same round trip.
  const { data: tickets, error } = await supabase
    .from('tickets')
    .select('id, subject, status, created_at, organization_id, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<
      Array<{
        id:              string
        subject:         string
        status:          TicketStatus
        created_at:      string
        organization_id: string
        organizations:   { name: string } | null
      }>
    >()

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Global Queue
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">Tickets</h1>
          <p className="mt-1 text-sm text-gray-400">
            Every ticket across every merchant. Showing the 200 most recent.
          </p>
        </div>
        <div className="text-xs font-medium text-gray-400">
          {tickets?.length ?? 0} shown
        </div>
      </header>

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
                  <td className="px-5 py-4 text-gray-300 truncate max-w-md">{t.subject}</td>
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
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-gray-500">
                  No tickets across the platform yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
