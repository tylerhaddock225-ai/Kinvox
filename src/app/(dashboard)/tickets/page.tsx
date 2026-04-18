import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Ticket } from '@/lib/types/database.types'
import CreateTicketModal from '@/components/CreateTicketModal'
import CopyId from '@/components/CopyId'

const STATUS_COLORS: Record<Ticket['status'], string> = {
  open:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  pending: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  closed:  'bg-gray-500/10 text-gray-400 border-gray-500/20',
}

const PRIORITY_COLORS: Record<Ticket['priority'], string> = {
  low:    'bg-gray-500/10 text-gray-400 border-gray-500/20',
  medium: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  high:   'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

type TicketRow = Pick<Ticket, 'id' | 'display_id' | 'subject' | 'status' | 'priority' | 'created_at' | 'assigned_to'> & {
  profiles: { full_name: string | null } | null
}

export default async function TicketsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const orgId = profile.organization_id

  const [ticketsRes, membersRes, leadsRes, orgRes] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, display_id, subject, status, priority, created_at, assigned_to, profiles!tickets_assigned_to_fkey(full_name)')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('organization_id', orgId),
    supabase
      .from('leads')
      .select('id, first_name, last_name')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('organizations')
      .select('verified_support_email')
      .eq('id', orgId)
      .single(),
  ])

  const rows    = (ticketsRes.data ?? []) as unknown as TicketRow[]
  const members = (membersRes.data ?? []) as { id: string; full_name: string | null }[]
  const leads   = (leadsRes.data   ?? []) as { id: string; first_name: string; last_name: string | null }[]
  const verifiedSupportEmail = orgRes.data?.verified_support_email ?? null

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tickets</h1>
          <p className="text-sm text-gray-400 mt-1">Support requests and customer issues.</p>
        </div>
        <CreateTicketModal members={members} leads={leads} />
      </div>

      {!verifiedSupportEmail && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-400" />
          <p>
            Emails are currently sending from Kinvox.{' '}
            <Link href="/settings/team" className="underline decoration-dotted underline-offset-4 hover:text-yellow-100">
              Verify your custom domain email in Settings
            </Link>{' '}
            to white-label your support.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            No tickets yet. Create your first ticket to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                <th className="px-3 py-3 text-left font-medium">Subject</th>
                <th className="px-3 py-3 text-left font-medium">Priority</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-left font-medium">Assigned</th>
                <th className="px-3 py-3 pr-6 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(t => (
                <tr key={t.id} className="hover:bg-violet-400/[0.07] transition-colors">
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={t.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium">
                    <Link href={`/tickets/${t.id}`} className="hover:text-violet-400 transition-colors">
                      {t.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${PRIORITY_COLORS[t.priority]}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-400">
                    {t.profiles?.full_name ?? <span className="text-gray-600">Unassigned</span>}
                  </td>
                  <td className="px-3 py-3 pr-6 text-gray-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-gray-500">Showing {rows.length} ticket{rows.length === 1 ? '' : 's'}.</p>
      )}
    </div>
  )
}
