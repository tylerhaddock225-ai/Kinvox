import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Mail, Phone, Building2, Tag, User, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Lead } from '@/lib/types/database.types'
import LeadStatusSelect from '@/components/LeadStatusSelect'
import LeadConversationPanel from '@/components/leads/LeadConversationPanel'
import { type ConversationMessage } from '@/components/conversation/ConversationThread'
import EditLeadModal from '@/components/EditLeadModal'
import CopyId from '@/components/CopyId'
import QuickScheduleModal from '@/components/QuickScheduleModal'

type LeadMessageRow = {
  id:                  string
  message_type:        'public_reply' | 'internal_note'
  author_kind:         'org_user' | 'lead' | 'system'
  author_user_id:      string | null
  body:                string
  inbound_email_from:  string | null
  created_at:          string
  profiles: { full_name: string | null } | null
}

function Field({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm text-gray-200 truncate">{value ?? <span className="text-gray-600">—</span>}</p>
      </div>
    </div>
  )
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; id: string }>
}) {
  const { orgSlug, id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!lead) notFound()
  const l = lead as Lead

  const [messagesRes, customerRes] = await Promise.all([
    supabase
      .from('lead_messages')
      .select('id, message_type, author_kind, author_user_id, body, inbound_email_from, created_at, profiles!lead_messages_author_user_id_fkey(full_name)')
      .eq('lead_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('customers')
      .select('id')
      .eq('lead_id', id)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  const messageRows = (messagesRes.data ?? []) as unknown as LeadMessageRow[]
  const linkedCustomerId = customerRes.data?.id ?? null

  // Normalize for the shared ConversationThread renderer. author_kind drives
  // the badge label; message_type drives the visual variant (public vs
  // internal coloring).
  const conversationMessages: ConversationMessage[] = messageRows.map((m) => {
    let authorName: string
    let authorBadge: string | undefined
    if (m.author_kind === 'lead') {
      const fallback = `${l.first_name} ${l.last_name ?? ''}`.trim() || 'Lead'
      authorName  = m.inbound_email_from ?? fallback
      authorBadge = 'Lead'
    } else if (m.author_kind === 'system') {
      authorName  = 'System'
      authorBadge = 'System'
    } else {
      authorName  = m.profiles?.full_name ?? 'Organization member'
      authorBadge = m.message_type === 'internal_note' ? 'Private Note' : undefined
    }
    return {
      id:         m.id,
      variant:    m.message_type === 'internal_note' ? 'internal' : 'public',
      authorName,
      authorBadge,
      body:       m.body,
      createdAt:  m.created_at,
    }
  })

  return (
    <div className="px-8 py-8 space-y-6">
      <div>
        <Link
          href={`/${orgSlug}/leads`}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Leads
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-white truncate">
            {l.first_name} {l.last_name ?? ''}
            {l.company && (
              <span className="ml-3 text-xl font-normal text-gray-400">{l.company}</span>
            )}
          </h1>
          <div className="shrink-0">
            <QuickScheduleModal leadId={l.id} />
          </div>
        </div>
        {l.display_id && (
          <div className="mt-0.5 text-xs">
            <CopyId id={l.display_id} />
          </div>
        )}
        {linkedCustomerId && (
          <div className="mt-1">
            <Link
              href={`/${orgSlug}/customers/${linkedCustomerId}`}
              className="text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors"
            >
              View Customer Profile →
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column — Info (1/3) */}
        <aside className="lg:col-span-1 space-y-6">

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</h2>
            <LeadStatusSelect leadId={l.id} initialStatus={l.status} />
          </div>

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Details</h2>
              <EditLeadModal lead={l} />
            </div>

            <div className="space-y-3">
              <Field icon={User}       label="Name"    value={`${l.first_name} ${l.last_name ?? ''}`.trim()} />
              <Field icon={Building2}  label="Company" value={l.company} />
              <Field icon={Mail}       label="Email"   value={l.email} />
              <Field icon={Phone}      label="Phone"   value={l.phone} />
              <Field icon={Tag}        label="Source"  value={l.source ? <span className="capitalize">{l.source}</span> : null} />
              <Field icon={Calendar}   label="Created" value={new Date(l.created_at).toLocaleDateString()} />
              {l.converted_at && (
                <Field icon={Calendar} label="Converted" value={new Date(l.converted_at).toLocaleDateString()} />
              )}
            </div>
          </div>

          {l.tags && l.tags.length > 0 && (
            <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Tags</h2>
              <div className="flex flex-wrap gap-1.5">
                {l.tags.map(t => (
                  <span key={t} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-500/10 text-violet-300 border border-violet-500/20">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Right column — Conversation (2/3). Unified thread of public
            replies + internal notes; replaces the old single-textarea
            Add Note + Activity-feed pair. */}
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-gray-300">Conversation</h2>
          <LeadConversationPanel
            leadId={l.id}
            orgSlug={orgSlug}
            messages={conversationMessages}
          />
        </section>
      </div>
    </div>
  )
}
