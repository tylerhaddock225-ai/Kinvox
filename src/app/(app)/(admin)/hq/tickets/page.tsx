import Link from 'next/link'
import { LifeBuoy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import CopyId from '@/components/CopyId'
import TicketStatusSelect from '@/components/TicketStatusSelect'
import TicketPrioritySelect from '@/components/TicketPrioritySelect'
import HQCategorySelect from '@/components/admin/HQCategorySelect'
import TicketRow from '@/components/TicketRow'

export const dynamic = 'force-dynamic'

type TicketStatus   = 'open' | 'pending' | 'closed'
type TicketPriority = 'low' | 'medium' | 'high'
type HQCategory     = 'bug' | 'billing' | 'feature_request' | 'question'
type Queue          = 'active' | 'closed'

const ACTIVE_STATUSES: TicketStatus[] = ['open', 'pending']

function QueueTab({ queue, current, count, label }: {
  queue:   Queue
  current: Queue
  count:   number
  label:   string
}) {
  const isActive = current === queue
  const href = queue === 'active' ? '/hq/tickets' : '/hq/tickets?queue=closed'
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

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>
}) {
  const supabase = await createClient()

  // Viewer's auth id for the per-user seen-tracking lookup (Part D). The
  // hq/layout gate guarantees an authenticated HQ admin here.
  const { data: { user } } = await supabase.auth.getUser()

  const params = await searchParams
  const queue: Queue = params.queue === 'closed' ? 'closed' : 'active'

  let listingQ = supabase
    .from('tickets')
    .select('id, display_id, subject, status, priority, created_at, last_ticket_activity_at, organization_id, is_platform_support, hq_category, organizations(name), reporter:profiles!tickets_created_by_fkey(full_name)')
    .eq('is_platform_support', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  listingQ = queue === 'closed'
    ? listingQ.eq('status', 'closed')
    : listingQ.in('status', ACTIVE_STATUSES)

  const [listingRes, activeCountRes, closedCountRes] = await Promise.all([
    listingQ.returns<
      Array<{
        id:                   string
        display_id:           string | null
        subject:              string
        status:               TicketStatus
        priority:             TicketPriority
        created_at:           string
        last_ticket_activity_at: string | null
        organization_id:      string
        is_platform_support:  boolean
        hq_category:          HQCategory | null
        organizations:        { name: string } | null
        reporter:             { full_name: string | null } | null
      }>
    >(),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('is_platform_support', true).is('deleted_at', null).in('status', ACTIVE_STATUSES),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('is_platform_support', true).is('deleted_at', null).eq('status', 'closed'),
  ])

  const tickets = listingRes.data
  const error   = listingRes.error

  // AD Stage 3b — grid markers. Two batched .in() queries keyed to the listed
  // tickets (no per-row round trips): this HQ admin's ticket_views for the unseen
  // dot (RLS "select hq_admin" arm), and ai_ticket_drafts existence for the
  // draft-ready sparkle (RLS "read own org or hq" → HQ sees all orgs' drafts, so
  // the sparkle flags which orgs' tickets have an AI draft awaiting approval).
  const viewMap  = new Map<string, string>()
  const draftSet = new Set<string>()
  if (user && tickets && tickets.length > 0) {
    const ticketIds = tickets.map(t => t.id)
    const [viewsRes, draftsRes] = await Promise.all([
      supabase
        .from('ticket_views')
        .select('ticket_id, last_viewed_at')
        .eq('user_id', user.id)
        .in('ticket_id', ticketIds),
      supabase
        .from('ai_ticket_drafts')
        .select('ticket_id')
        .in('ticket_id', ticketIds),
    ])
    for (const v of (viewsRes.data ?? []) as { ticket_id: string; last_viewed_at: string }[]) {
      viewMap.set(v.ticket_id, v.last_viewed_at)
    }
    for (const d of (draftsRes.data ?? []) as { ticket_id: string }[]) {
      draftSet.add(d.ticket_id)
    }
  }

  // Unseen = a customer-originated event (org create/reply on a platform-support
  // ticket, or inbound customer email on a regular ticket) landed since this HQ
  // admin last opened it. Epoch-ms compare — mirrors the tenant tickets grid.
  function hasUnseenActivity(t: { id: string; last_ticket_activity_at: string | null }): boolean {
    if (!t.last_ticket_activity_at) return false
    const lastViewed = viewMap.get(t.id)
    if (!lastViewed) return true
    return new Date(t.last_ticket_activity_at).getTime() > new Date(lastViewed).getTime()
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Global Queue
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">Tickets</h1>
          <p className="mt-1 text-sm text-gray-400">
            Every ticket across every organization. Showing the 200 most recent.
          </p>
        </div>
        <div className="text-xs font-medium text-gray-400">
          {tickets?.length ?? 0} shown
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-pvx-border">
        <QueueTab queue="active" current={queue} count={activeCountRes.count ?? 0} label="Active" />
        <QueueTab queue="closed" current={queue} count={closedCountRes.count ?? 0} label="Closed" />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          Failed to load tickets: {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="pl-6 pr-1 py-3 w-9" aria-hidden="true" />
              <th className="pl-3 pr-5 py-3 w-32">ID</th>
              <th className="px-5 py-3">Organization</th>
              <th className="px-5 py-3">Subject</th>
              <th className="px-5 py-3">From</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {tickets?.length ? (
              tickets.map((t) => (
                <TicketRow key={t.id} href={`/hq/tickets/${t.id}`} unseen={hasUnseenActivity(t)} draftReady={draftSet.has(t.id)}>
                  <td className="pl-3 pr-5 py-4 text-xs">
                    <CopyId id={t.display_id} />
                  </td>
                  <td className="px-5 py-4 text-gray-100 font-medium">
                    {t.organizations?.name ?? <span className="text-gray-500">Unknown</span>}
                  </td>
                  <td className="px-5 py-4 text-gray-300 max-w-md">
                    <span className="inline-flex items-center gap-2">
                      {t.is_platform_support && (
                        <LifeBuoy className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-label="Platform support" />
                      )}
                      <span className="truncate">{t.subject}</span>
                    </span>
                  </td>
                  <td className="px-5 py-4 text-gray-400 max-w-[14rem] truncate" title={t.reporter?.full_name ?? '—'}>
                    {t.reporter?.full_name ?? '—'}
                  </td>
                  <td className="px-5 py-4">
                    {t.is_platform_support && t.hq_category ? (
                      <HQCategorySelect ticketId={t.id} value={t.hq_category} />
                    ) : (
                      <span className="inline-block rounded-full border border-gray-500/30 bg-gray-500/10 px-2 py-0.5 text-xs font-medium text-gray-300">
                        General
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <TicketPrioritySelect ticketId={t.id} value={t.priority} />
                  </td>
                  <td className="px-5 py-4">
                    <TicketStatusSelect ticketId={t.id} value={t.status} />
                  </td>
                  <td className="px-5 py-4 text-right text-xs text-gray-500 font-mono">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                </TicketRow>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-5 py-10 text-center text-sm text-gray-500">
                  {queue === 'closed' ? 'No closed tickets.' : 'No active tickets.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
