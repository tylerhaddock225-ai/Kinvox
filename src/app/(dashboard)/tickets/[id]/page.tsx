import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Ticket, TicketMessage } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import EditableSubject from '@/components/EditableSubject'
import ReplyBox from '@/components/ReplyBox'

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

type MessageRow = Pick<TicketMessage, 'id' | 'body' | 'type' | 'created_at' | 'sender_id'> & {
  profiles: { full_name: string | null } | null
}

function initials(name: string | null | undefined) {
  if (!name) return '??'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '??'
}

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const { data: ticketData } = await supabase
    .from('tickets')
    .select('id, display_id, subject, description, status, priority, created_at, organization_id')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single()

  if (!ticketData) notFound()

  const ticket = ticketData as Pick<Ticket, 'id' | 'display_id' | 'subject' | 'description' | 'status' | 'priority' | 'created_at' | 'organization_id'>

  const { data: messagesData } = await supabase
    .from('ticket_messages')
    .select('id, body, type, created_at, sender_id, profiles!ticket_messages_sender_id_fkey(full_name)')
    .eq('ticket_id', id)
    .order('created_at', { ascending: true })

  const messages = (messagesData ?? []) as unknown as MessageRow[]

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto space-y-6">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <EditableSubject ticketId={ticket.id} initial={ticket.subject} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${PRIORITY_COLORS[ticket.priority]}`}>
              {ticket.priority}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[ticket.status]}`}>
              {ticket.status}
            </span>
          </div>
        </div>
        <div className="text-xs">
          <CopyId id={ticket.display_id} />
        </div>
      </div>

      {ticket.description && (
        <div className="bg-pvx-surface/50 border border-pvx-border rounded-lg p-6 mb-8">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Original Message
          </div>
          <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
            {ticket.description}
          </div>
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
        <ReplyBox ticketId={ticket.id} />
      </section>
    </div>
  )
}
