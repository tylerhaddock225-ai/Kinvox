import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Ticket, TicketMessage } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'
import EditableSubject from '@/components/EditableSubject'
import ReplyBox from '@/components/ReplyBox'
import TicketStatusSelect from '@/components/TicketStatusSelect'
import TicketPrioritySelect from '@/components/TicketPrioritySelect'
import TicketRecipientsSection, { type RecipientRow } from '@/components/TicketRecipientsSection'

type MessageRow = Pick<TicketMessage, 'id' | 'body' | 'type' | 'created_at' | 'sender_id' | 'inbound_email_from'> & {
  profiles: { full_name: string | null } | null
}

type RecipientQueryRow = {
  id:       string
  kind:     'to' | 'cc'
  user_id:  string | null
  email:    string | null
  added_at: string
  profiles: { full_name: string | null } | null
}

function initials(name: string | null | undefined) {
  if (!name) return '??'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '??'
}

export default async function TicketDetailPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ticketData } = await supabase
    .from('tickets')
    .select('id, display_id, subject, description, status, priority, created_at, organization_id, is_platform_support, organizations(slug)')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!ticketData) notFound()

  // Platform-support tickets live under the branded slug-scoped route now.
  // Anything still hitting /tickets/[id] for an HQ ticket gets bounced there
  // so stale bookmarks and cross-references keep working.
  const ticketRow = ticketData as unknown as {
    is_platform_support: boolean
    organizations:       { slug: string | null } | { slug: string | null }[] | null
  }
  if (ticketRow.is_platform_support) {
    const org = Array.isArray(ticketRow.organizations)
      ? ticketRow.organizations[0]
      : ticketRow.organizations
    if (org?.slug) redirect(`/${org.slug}/hq-support/${id}`)
  }

  const ticket = ticketData as Pick<Ticket, 'id' | 'display_id' | 'subject' | 'description' | 'status' | 'priority' | 'created_at' | 'organization_id'>

  // AD Stage 3 — record this view so the tickets-grid unseen dot clears for
  // this user. Mirrors leads/[id] (lead_views). We await because the query
  // builder is a deferred thenable — no await = no HTTP request. RLS enforces
  // org scoping via the ticket_id → org chain (safe under HQ impersonation).
  // Non-fatal: a badge-state miss must never block render.
  const { error: viewErr } = await supabase
    .from('ticket_views')
    .upsert(
      { ticket_id: id, user_id: user.id, last_viewed_at: new Date().toISOString() },
      { onConflict: 'ticket_id,user_id' },
    )
  if (viewErr) {
    console.error(`[tickets/${id}] ticket_views upsert failed:`, viewErr.message)
  }

  const [messagesRes, recipientsRes, draftRes] = await Promise.all([
    supabase
      .from('ticket_messages')
      .select('id, body, type, created_at, sender_id, inbound_email_from, profiles!ticket_messages_sender_id_fkey(full_name)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('ticket_recipients')
      .select('id, kind, user_id, email, added_at, profiles!ticket_recipients_user_id_fkey(full_name)')
      .eq('ticket_id', ticket.id)
      .order('added_at', { ascending: true }),
    // AD Stage 5 — the stored AI draft (RLS SELECT covers own-org + HQ).
    supabase
      .from('ai_ticket_drafts')
      .select('body, source_message_id')
      .eq('ticket_id', id)
      .maybeSingle(),
  ])

  const messages = (messagesRes.data ?? []) as unknown as MessageRow[]

  // AD Stage 5 — pre-fill the composer from the stored AI draft, but ONLY when it
  // answers the CURRENT latest inbound message (source_message_id match). A stale
  // draft (a newer customer message arrived since) is not shown — the webhook
  // already deletes stale drafts, this is belt-and-braces.
  const draftRow = draftRes.data as { body: string; source_message_id: string | null } | null
  const latestInboundId =
    [...messages].reverse().find(m => m.sender_id === null)?.id ?? null
  const initialDraft =
    draftRow && latestInboundId && draftRow.source_message_id === latestInboundId
      ? draftRow.body
      : undefined

  const rawRecipients = (recipientsRes.data ?? []) as unknown as RecipientQueryRow[]
  const recipients: RecipientRow[] = rawRecipients.map(r => ({
    id:           r.id,
    kind:         r.kind,
    user_id:      r.user_id,
    email:        r.email,
    display_name: r.profiles?.full_name ?? null,
  }))

  return (
    <div className="px-8 py-8 space-y-6">
      <div>
        <Link
          href={`/${orgSlug}/tickets`}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Tickets
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <EditableSubject ticketId={ticket.id} initial={ticket.subject} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TicketPrioritySelect ticketId={ticket.id} value={ticket.priority} size="md" />
            <TicketStatusSelect   ticketId={ticket.id} value={ticket.status}   size="md" />
          </div>
        </div>
        <div className="mt-0.5 text-xs">
          <CopyId id={ticket.display_id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <aside className="lg:col-span-1 space-y-6">
          <TicketRecipientsSection ticketId={ticket.id} recipients={recipients} mode="org" />
        </aside>

        <div className="lg:col-span-2 space-y-6">
          {ticket.description && (
            <div className="bg-pvx-surface/50 border border-pvx-border rounded-lg p-6">
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
                  // Inbound customer emails have sender_id = null (no profile); fall back to
                  // the inbound From address so the thread shows the real sender, not 'Unknown'.
                  const author = m.profiles?.full_name ?? m.inbound_email_from ?? 'Unknown'
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
            <ReplyBox ticketId={ticket.id} initialDraft={initialDraft} />
          </section>
        </div>
      </div>
    </div>
  )
}
