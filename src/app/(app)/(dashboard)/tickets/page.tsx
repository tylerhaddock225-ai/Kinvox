import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import type { Ticket } from '@/lib/types/database.types'
import CreateTicketModal from '@/components/CreateTicketModal'
import CopyId from '@/components/CopyId'
import TicketStatusSelect from '@/components/TicketStatusSelect'
import TicketPrioritySelect from '@/components/TicketPrioritySelect'
import TicketsFilterBar from '@/components/TicketsFilterBar'
import TicketRow from '@/components/TicketRow'
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

function QueueTab({
  queue,
  current,
  count,
  params,
  label,
}: {
  queue:   'active' | 'closed'
  current: 'active' | 'closed'
  count:   number
  params:  Record<string, string | undefined>
  label:   string
}) {
  // Preserve sort/order/priority/assigned across tab switches; drop a stale
  // `status` filter (it'd usually conflict with the new queue).
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    if (k === 'queue' || k === 'status') continue
    next.set(k, v)
  }
  if (queue !== 'active') next.set('queue', queue)

  const href = `/tickets${next.toString() ? `?${next.toString()}` : ''}`
  const isActive = current === queue

  return (
    <Link
      href={href}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        isActive
          ? 'border-violet-500 text-white'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
      <span className="ml-1.5 text-xs text-gray-500">({count})</span>
    </Link>
  )
}

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

type Queue = 'active' | 'closed'

const ACTIVE_STATUSES: Ticket['status'][] = ['open', 'pending']

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?:   string
    priority?: string
    assigned?: string
    sort?:     string
    order?:    string
    queue?:    string
  }>
}) {
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

  const orgId   = effectiveOrgId

  // Slug for the settings/team link further down. Tickets still lives at
  // the non-scoped /tickets path, so we can't pull orgSlug from route params.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .maybeSingle<{ slug: string | null }>()
  const orgSlug = orgRow?.slug ?? null

  const params  = await searchParams
  const requestedQueue: Queue = params.queue === 'closed' ? 'closed' : 'active'

  // If the URL carries a `status` filter that contradicts the requested queue,
  // bounce to the matching queue (preserving every other param). Avoids the
  // "No tickets match" empty state for `?status=closed` on the Active tab and
  // vice versa for `?status=open|pending` on the Closed tab.
  const requestedStatus = params.status ?? ''
  const conflictingActive = requestedQueue === 'active' && requestedStatus === 'closed'
  const conflictingClosed = requestedQueue === 'closed' && (requestedStatus === 'open' || requestedStatus === 'pending')
  if (conflictingActive || conflictingClosed) {
    const correctQueue: Queue = conflictingActive ? 'closed' : 'active'
    const next = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (!v || k === 'queue') continue
      next.set(k, v)
    }
    if (correctQueue !== 'active') next.set('queue', correctQueue)
    redirect(`/tickets${next.toString() ? `?${next.toString()}` : ''}`)
  }

  const queue: Queue = requestedQueue
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
    .eq('is_platform_support', false)
    .is('deleted_at', null)
    // For JS-sorted columns we still need a deterministic DB order so the 200-row
    // window we fetch is stable; default to updated_at desc inside that.
    .order(isJsSort ? 'updated_at' : dbSortCol, { ascending: isJsSort ? false : sortOrder === 'asc' })
    .limit(200)

  // Queue constraint always applies — it's the tab the user is on.
  ticketsQ = queue === 'closed'
    ? ticketsQ.eq('status', 'closed')
    : ticketsQ.in('status', ACTIVE_STATUSES)

  // The status filter narrows further within the queue.
  if (fStatus) ticketsQ = ticketsQ.eq('status', fStatus)
  if (fPrio)   ticketsQ = ticketsQ.eq('priority', fPrio)
  if (fAssigned === 'unassigned') ticketsQ = ticketsQ.is('assigned_to', null)
  else if (fAssigned)             ticketsQ = ticketsQ.eq('assigned_to', fAssigned)

  const [ticketsRes, membersRes, customersRes, orgRes, activeCountRes, closedCountRes] = await Promise.all([
    ticketsQ,
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('organization_id', orgId),
    supabase
      .from('customers')
      .select('id, first_name, last_name, email')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('first_name', { ascending: true })
      .limit(500),
    supabase
      .from('organizations')
      .select('verified_support_email')
      .eq('id', orgId)
      .single(),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_platform_support', false)
      .is('deleted_at', null)
      .in('status', ACTIVE_STATUSES),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_platform_support', false)
      .is('deleted_at', null)
      .eq('status', 'closed'),
  ])

  const activeCount = activeCountRes.count ?? 0
  const closedCount = closedCountRes.count ?? 0

  const rawRows   = (ticketsRes.data   ?? []) as unknown as TicketRow[]
  const customers = (customersRes.data ?? []) as { id: string; first_name: string; last_name: string | null; email: string | null }[]
  const rows    = isJsSort
    ? [...rawRows].sort((a, b) => {
        const diff = sortKey === 'priority'
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          : STATUS_RANK[a.status]     - STATUS_RANK[b.status]
        return sortOrder === 'asc' ? diff : -diff
      })
    : rawRows
  const members = (membersRes.data ?? []) as { id: string; full_name: string | null }[]
  const verifiedSupportEmail = orgRes.data?.verified_support_email ?? null

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tickets</h1>
          <p className="text-sm text-gray-400 mt-1">Support requests and customer issues.</p>
        </div>
        <CreateTicketModal members={members} customers={customers} />
      </div>

      {!verifiedSupportEmail && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-400" />
          <p>
            Emails are currently sending from Kinvox.{' '}
            <Link
              href={orgSlug ? `/${orgSlug}/settings/team` : '/pending-invite'}
              className="underline decoration-dotted underline-offset-4 hover:text-yellow-100"
            >
              Verify your custom domain email in Settings
            </Link>{' '}
            to white-label your support.
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-pvx-border">
        <QueueTab queue="active" current={queue} count={activeCount} params={params} label="Active" />
        <QueueTab queue="closed" current={queue} count={closedCount} params={params} label="Closed" />
      </div>

      <TicketsFilterBar members={members} queue={queue} />

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {fStatus || fPrio || fAssigned
              ? 'No tickets match the current filters.'
              : queue === 'closed'
                ? 'No closed tickets.'
                : 'No active tickets. Create one to get started.'}
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
                <TicketRow key={t.id} href={`/tickets/${t.id}`}>
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
                </TicketRow>
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
