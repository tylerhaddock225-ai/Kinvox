import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LifeBuoy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Ticket } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import HQSupportModal from '@/components/HQSupportModal'
import TicketRow from '@/components/TicketRow'

export const dynamic = 'force-dynamic'

type TicketStatus = 'open' | 'pending' | 'closed'
type HQCategory   = 'bug' | 'billing' | 'feature_request' | 'question'
type Queue        = 'active' | 'closed'

const ACTIVE_STATUSES: TicketStatus[] = ['open', 'pending']

const STATUS_STYLE: Record<TicketStatus, string> = {
  open:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  closed:  'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const CATEGORY_LABEL: Record<HQCategory, string> = {
  bug:              'Bug',
  billing:          'Billing',
  feature_request:  'Feature',
  question:         'Question',
}

const CATEGORY_STYLE: Record<HQCategory, string> = {
  bug:              'border-rose-500/30 bg-rose-500/10 text-rose-300',
  billing:          'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  feature_request:  'border-violet-500/30 bg-violet-500/10 text-violet-300',
  question:         'border-sky-500/30 bg-sky-500/10 text-sky-300',
}

type Row = Pick<Ticket, 'id' | 'display_id' | 'subject' | 'status' | 'created_at' | 'updated_at' | 'hq_category'>

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.round(diff / 60_000)
  if (min < 1)    return 'just now'
  if (min < 60)   return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24)    return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30)   return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function QueueTab({ queue, current, count, label }: {
  queue:   Queue
  current: Queue
  count:   number
  label:   string
}) {
  const href = queue === 'active' ? '/support' : `/support?queue=${queue}`
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

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>
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

  const orgId = profile.organization_id
  const params = await searchParams
  const queue: Queue = params.queue === 'closed' ? 'closed' : 'active'

  let ticketsQ = supabase
    .from('tickets')
    .select('id, display_id, subject, status, created_at, updated_at, hq_category')
    .eq('organization_id', orgId)
    .eq('is_platform_support', true)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(200)

  ticketsQ = queue === 'closed'
    ? ticketsQ.eq('status', 'closed')
    : ticketsQ.in('status', ACTIVE_STATUSES)

  const [ticketsRes, activeCountRes, closedCountRes, settingsRes] = await Promise.all([
    ticketsQ,
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_platform_support', true)
      .is('deleted_at', null)
      .in('status', ACTIVE_STATUSES),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_platform_support', true)
      .is('deleted_at', null)
      .eq('status', 'closed'),
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['show_affected_tab_field', 'show_record_id_field']),
  ])

  const settingsMap = new Map<string, unknown>((settingsRes.data ?? []).map(r => [r.key, r.value]))
  const showAffectedTab = settingsMap.get('show_affected_tab_field') === true
  const showRecordId    = settingsMap.get('show_record_id_field')    === true

  const rows = (ticketsRes.data ?? []) as Row[]
  const activeCount = activeCountRes.count ?? 0
  const closedCount = closedCountRes.count ?? 0

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            <LifeBuoy className="w-3.5 h-3.5" />
            HQ Support
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">Your HQ Requests</h1>
          <p className="text-sm text-gray-400 mt-1">
            Support requests you've sent to the Kinvox team. Replies thread in here.
          </p>
        </div>
        <HQSupportModal showAffectedTab={showAffectedTab} showRecordId={showRecordId} />
      </div>

      <div className="flex items-center gap-1 border-b border-pvx-border">
        <QueueTab queue="active" current={queue} count={activeCount} label="Active" />
        <QueueTab queue="closed" current={queue} count={closedCount} label="Closed" />
      </div>

      <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500 text-sm">
            {queue === 'closed'
              ? 'No closed HQ requests.'
              : 'No active HQ requests. Use New HQ Request to send one.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                <th className="px-3 py-3 text-left font-medium">Subject</th>
                <th className="px-3 py-3 text-left font-medium">Category</th>
                <th className="px-3 py-3 text-left font-medium">Status</th>
                <th className="px-3 py-3 text-left font-medium">Updated</th>
                <th className="px-3 py-3 pr-6 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pvx-border">
              {rows.map(t => (
                <TicketRow key={t.id} href={`/tickets/${t.id}`}>
                  <td className="pl-6 pr-3 py-3 text-xs">
                    <CopyId id={t.display_id} />
                  </td>
                  <td className="px-3 py-3 text-gray-200 font-medium max-w-md">
                    <span className="inline-flex items-center gap-2">
                      <LifeBuoy className="w-3.5 h-3.5 text-violet-400 shrink-0" aria-hidden />
                      <span className="truncate">{t.subject}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {t.hq_category ? (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${CATEGORY_STYLE[t.hq_category]}`}
                      >
                        {CATEGORY_LABEL[t.hq_category]}
                      </span>
                    ) : (
                      <span className="inline-block rounded-full border border-gray-500/30 bg-gray-500/10 px-2 py-0.5 text-[11px] font-medium text-gray-300">
                        General
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_STYLE[t.status]}`}
                    >
                      {t.status}
                    </span>
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
        <p className="text-xs text-gray-500">Showing {rows.length} request{rows.length === 1 ? '' : 's'}.</p>
      )}
    </div>
  )
}
