import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, LifeBuoy } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Ticket, TicketMessage } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import EditableSubject from '@/components/EditableSubject'
import TicketStatusSelect from '@/components/TicketStatusSelect'
import TicketPrioritySelect from '@/components/TicketPrioritySelect'
import HQReplyBox from '@/components/admin/HQReplyBox'

type MessageRow = Pick<TicketMessage, 'id' | 'body' | 'type' | 'created_at' | 'sender_id'> & {
  profiles: { full_name: string | null } | null
}

type HQCategory  = 'bug' | 'billing' | 'feature_request' | 'question'
type AffectedTab = 'dashboard' | 'leads' | 'customers' | 'appointments' | 'tickets' | 'settings'

const CATEGORY_LABEL: Record<HQCategory, string> = {
  bug:              'Bug',
  billing:          'Billing',
  feature_request:  'Feature Request',
  question:         'Question',
}

const TAB_LABEL: Record<AffectedTab, string> = {
  dashboard:    'Dashboard',
  leads:        'Leads',
  customers:    'Customers',
  appointments: 'Appointments',
  tickets:      'Tickets',
  settings:     'Settings',
}

function initials(name: string | null | undefined) {
  if (!name) return '??'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '??'
}

export default async function HQTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Layout (hq/layout.tsx) already gates on profile.system_role,
  // so the caller here is an HQ admin. RLS lets them read across orgs.
  const { data: ticketData } = await supabase
    .from('tickets')
    .select('id, display_id, subject, description, status, priority, created_at, organization_id, is_platform_support, hq_category, screenshot_url, affected_tab, record_id, organizations(name)')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!ticketData) notFound()

  const ticket = ticketData as unknown as Pick<
    Ticket,
    'id' | 'display_id' | 'subject' | 'description' | 'status' | 'priority' | 'created_at' | 'organization_id' | 'is_platform_support' | 'hq_category' | 'screenshot_url' | 'affected_tab' | 'record_id'
  > & { organizations: { name: string } | null }

  const { data: messagesData } = await supabase
    .from('ticket_messages')
    .select('id, body, type, created_at, sender_id, profiles!ticket_messages_sender_id_fkey(full_name)')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true })

  const messages = (messagesData ?? []) as unknown as MessageRow[]
  const isPlatform = !!ticket.is_platform_support

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link
          href={isPlatform ? '/hq/tickets?scope=platform' : '/hq/tickets'}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Tickets
        </Link>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 flex items-start gap-3">
            {isPlatform && (
              <LifeBuoy className="w-5 h-5 text-violet-400 mt-1 shrink-0" aria-label="Platform support" />
            )}
            <div className="flex-1 min-w-0">
              <EditableSubject ticketId={ticket.id} initial={ticket.subject} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TicketPrioritySelect ticketId={ticket.id} value={ticket.priority} size="md" />
            <TicketStatusSelect   ticketId={ticket.id} value={ticket.status}   size="md" />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <CopyId id={ticket.display_id} />
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">
            {ticket.organizations?.name ?? <span className="text-gray-600">Unknown org</span>}
          </span>
          {isPlatform && ticket.hq_category && (
            <>
              <span className="text-gray-600">·</span>
              <span className="inline-flex items-center rounded-md border border-violet-700/60 bg-violet-950/40 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-300">
                {CATEGORY_LABEL[ticket.hq_category as HQCategory]}
              </span>
            </>
          )}
        </div>
      </div>

      {isPlatform && (ticket.affected_tab || ticket.record_id) && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-300 mb-3">
            Organization Context
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {ticket.affected_tab && (
              <div>
                <dt className="text-xs text-gray-500">Affected Tab</dt>
                <dd className="text-gray-200 mt-0.5">{TAB_LABEL[ticket.affected_tab as AffectedTab]}</dd>
              </div>
            )}
            {ticket.record_id && (
              <div>
                <dt className="text-xs text-gray-500">Record ID</dt>
                <dd className="text-gray-200 mt-0.5 font-mono text-xs break-all">{ticket.record_id}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {ticket.description && (
        <div className="bg-pvx-surface/50 border border-pvx-border rounded-lg p-6">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Original Message
          </div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
            {ticket.description}
          </div>
          {isPlatform && ticket.screenshot_url && (
            <div className="mt-4 text-xs">
              <span className="text-gray-500">Screenshot: </span>
              <a
                href={ticket.screenshot_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 hover:text-violet-300 underline decoration-dotted underline-offset-4 break-all"
              >
                {ticket.screenshot_url}
              </a>
            </div>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">Conversation</h2>

        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface/30 px-6 py-10 text-center text-sm text-gray-500">
            No messages yet. Start the conversation below.
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map(m => {
              const isInternal = m.type === 'internal'
              const author = m.profiles?.full_name ?? 'Unknown'
              return (
                <li
                  key={m.id}
                  className={`rounded-xl border px-4 py-3 ${
                    isInternal
                      ? 'border-yellow-500/30 bg-yellow-500/10'
                      : 'border-pvx-border bg-pvx-surface'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-600/20 text-violet-300 text-[11px] font-semibold">
                        {initials(author)}
                      </span>
                      <span className="text-sm font-medium text-white">{author}</span>
                      {isInternal && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                          Private Note
                        </span>
                      )}
                    </div>
                    <time className="text-xs text-gray-500">
                      {new Date(m.created_at).toLocaleString()}
                    </time>
                  </div>
                  <div className="text-sm text-gray-200 whitespace-pre-wrap">{m.body}</div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-pvx-border bg-pvx-surface p-4">
        <HQReplyBox ticketId={ticket.id} />
      </section>
    </div>
  )
}
