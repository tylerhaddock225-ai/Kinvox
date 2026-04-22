import { Check, Inbox } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveApplication } from './actions'

export const dynamic = 'force-dynamic'

type Row = {
  id:            string
  business_name: string
  email:         string
  website:       string
  status:        'new' | 'contacted' | 'approved' | 'rejected'
  created_at:    string
  reviewed_at:   string | null
}

const STATUS_STYLES: Record<Row['status'], string> = {
  new:       'border-violet-800/60 bg-violet-950/40 text-violet-300',
  contacted: 'border-amber-800/60 bg-amber-950/40 text-amber-300',
  approved:  'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
  rejected:  'border-rose-900/60 bg-rose-950/40 text-rose-300',
}

const STATUS_DOTS: Record<Row['status'], string> = {
  new:       'bg-violet-400',
  contacted: 'bg-amber-400',
  approved:  'bg-emerald-400',
  rejected:  'bg-rose-400',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default async function AdminApplicationsPage() {
  // Layout already enforces platform role. applications is RLS-locked,
  // so we use the service-role client to read it here. The approve
  // action goes through a SECURITY DEFINER RPC that re-checks role.
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('applications')
    .select('id, business_name, email, website, status, created_at, reviewed_at')
    .order('created_at', { ascending: false })
    .returns<Row[]>()

  const rows: Row[] = data ?? []
  const pending = rows.filter(r => r.status === 'new').length

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Applications</h1>
          <p className="mt-1 text-sm text-gray-400">
            Inbound leads from the public /apply form. Approve to create the
            tenant organization.
          </p>
        </div>
        <div className="text-xs font-medium text-gray-400">
          <span className="text-white">{pending}</span> awaiting review · {rows.length} total
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load applications: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Business</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Website</th>
              <th className="px-5 py-3">Submitted</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {rows.length ? rows.map((app) => (
              <tr key={app.id} className="transition-colors hover:bg-violet-400/[0.05]">
                <td className="px-5 py-4 font-medium text-gray-100">{app.business_name}</td>
                <td className="px-5 py-4 text-gray-300">
                  <a href={`mailto:${app.email}`} className="hover:text-violet-200">
                    {app.email}
                  </a>
                </td>
                <td className="px-5 py-4 text-gray-300">
                  <a
                    href={app.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-violet-200"
                  >
                    {new URL(app.website).hostname}
                  </a>
                </td>
                <td className="px-5 py-4 text-gray-400">{formatDate(app.created_at)}</td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${STATUS_STYLES[app.status]}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[app.status]}`} />
                    {app.status}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  {app.status !== 'approved' && (
                    <form action={approveApplication}>
                      <input type="hidden" name="id" value={app.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 hover:text-emerald-100 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-500">
                  <Inbox className="mx-auto mb-2 h-5 w-5 text-gray-600" />
                  No applications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
