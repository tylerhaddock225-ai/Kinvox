import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Ticket } from '@/lib/types/database.types'
import CreateTicketModal from '@/components/CreateTicketModal'
import CopyId from '@/components/CopyId'
import TicketStatusSelect from '@/components/TicketStatusSelect'
import TicketPrioritySelect from '@/components/TicketPrioritySelect'
import TicketsFilterBar from '@/components/TicketsFilterBar'
import TicketsRow from '@/components/TicketsRow'
import SortableHeader from '@/components/SortableHeader'

type TicketRow = Pick<
  Ticket,
  'id' | 'display_id' | 'subject' | 'status' | 'priority' | 'created_at' | 'updated_at' | 'assigned_to'
> & { profiles: { full_name: string | null } | null }

const STATUSES   = ['open', 'pending', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const

// Maps URL `sort` keys → DB columns. Keys not present here are ignored.
// `priority` and `status` need a custom rank (alphabetical isn't useful), so
// they're sorted in JS after the fetch — see PRIORITY_RANK / STATUS_RANK below.
const SORT_COLUMNS = {
  id:       'display_id',
  updated:  'updated_at',
  created:  'created_at',
} as const

const PRIORITY_RANK: Record<Ticket['priority'], number> = { high: 0, medium: 1, low: 2 }
const STATUS_RANK:   Record<Ticket['status'],   number> = { open: 0, pending: 1, closed: 2 }

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min  = Math.round(diff / 60_000)
  if (min < 1)    return 'just now'
  if (min < 60)   return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24)    return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30)   return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?:   string
    priority?: string
    assigned?: string
    sort?:     string
    order?:    string
  }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const orgId   = profile.organization_id
  const params  = await searchParams
  const fStatus = STATUSES.includes(params.status as (typeof STATUSES)[number])
    ? (params.status as (typeof STATUSES)[number])
    : null
  const fPrio   = PRIORITIES.includes(params.priority as (typeof PRIORITIES)[number])
    ? (params.priority as (typeof PRIORITIES)[number])
    : null
  const fAssigned = params.assigned ?? null

  // Sort: validate against the allowed-keys list; default updated/desc.
  const sortKey   = params.sort  ?? 'updated'
  const sortOrder = params.order === 'asc' ? 'asc' : 'desc'
  const isJsSort  = sortKey === 'priority' || sortKey === 'status'
  const dbSortCol =
    sortKey in SORT_COLUMNS
      ? SORT_COLUMNS[sortKey as keyof typeof SORT_COLUMNS]
      : 'updated_at'

  let ticketsQ = supabase
    .from('tickets')
    .select('id, display_id, subject, status, priority, created_at, updated_at, assigned_to, profiles!tickets_assigned_to_fkey(full_name)')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    // For JS-sorted columns we still need a deterministic DB order so the 200-row
    // window we fetch is stable; default to updated_at desc inside that.
    .order(isJsSort ? 'updated_at' : dbSortCol, { ascending: isJsSort ? false : sortOrder === 'asc' })
    .limit(200)

  if (fStatus) ticketsQ = ticketsQ.eq('status', fStatus)
  if (fPrio)   ticketsQ = ticketsQ.eq('priority', fPrio)
  if (fAssigned === 'unassigned') ticketsQ = ticketsQ.is('assigned_to', null)
  else if (fAssigned)             ticketsQ = ticketsQ.eq('assigned_to', fAssigned)

  const [ticketsRes, membersRes, leadsRes, orgRes] = await Promise.all([
    ticketsQ,
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

  const rawRows = (ticketsRes.data ?? []) as unknown as TicketRow[]
  const rows    = isJsSort
    ? [...rawRows].sort((a, b) => {
        const diff = sortKey === 'priority'
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          : STATUS_RANK[a.status]     - STATUS_RANK[b.status]
        return sortOrder === 'asc' ? diff : -diff
      })
    : rawRows
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

      <TicketsFilterBar members={members} />

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {fStatus || fPrio || fAssigned
              ? 'No tickets match the current filters.'
              : 'No tickets yet. Create your first ticket to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">
                  <SortableHeader label="ID" sortKey="id" defaultOrder="asc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">Subject</th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Priority" sortKey="priority" defaultOrder="asc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Status" sortKey="status" defaultOrder="asc" />
                </th>
                <th className="px-3 py-3 text-left font-medium">Assigned</th>
                <th className="px-3 py-3 text-left font-medium">
                  <SortableHeader label="Updated" sortKey="updated" defaultOrder="desc" />
                </th>
                <th className="px-3 py-3 pr-6 text-left font-medium">
                  <SortableHeader label="Created" sortKey="created" defaultOrder="desc" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(t => (
                <TicketsRow key={t.id} ticketId={t.id}>
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={t.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium">
                    <Link href={`/tickets/${t.id}`} className="hover:text-violet-400 transition-colors">
                      {t.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <TicketPrioritySelect ticketId={t.id} value={t.priority} />
                  </td>
                  <td className="px-3 py-3">
                    <TicketStatusSelect ticketId={t.id} value={t.status} />
                  </td>
                  <td className="px-3 py-3 text-gray-400">
                    {t.profiles?.full_name ?? <span className="text-gray-600">Unassigned</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-400" title={new Date(t.updated_at).toLocaleString()}>
                    {formatRelative(t.updated_at)}
                  </td>
                  <td className="px-3 py-3 pr-6 text-gray-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </TicketsRow>
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
