import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Mail, Phone, Building2, Tag, User, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Lead, LeadActivity } from '@/lib/types/database.types'
import LeadStatusSelect from '@/components/LeadStatusSelect'
import LeadNotesForm from '@/components/LeadNotesForm'
import LeadActivityList, { type Activity } from '@/components/LeadActivityList'
import EditLeadModal from '@/components/EditLeadModal'
import CopyId from '@/components/CopyId'
import QuickScheduleModal from '@/components/QuickScheduleModal'

type ActivityRow = LeadActivity & {
  profiles: { full_name: string | null; avatar_url: string | null } | null
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

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const [activitiesRes, customerRes] = await Promise.all([
    supabase
      .from('lead_activities')
      .select('id, lead_id, user_id, content, created_at, profiles(full_name, avatar_url)')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('customers')
      .select('id')
      .eq('lead_id', id)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  const rows = (activitiesRes.data ?? []) as unknown as ActivityRow[]
  const linkedCustomerId = customerRes.data?.id ?? null
  const feed: Activity[] = rows.map(a => ({
    id:         a.id,
    content:    a.content,
    created_at: a.created_at,
    author:     a.profiles?.full_name ?? null,
  }))

  return (
    <div className="px-8 py-8 space-y-6">
      <div>
        <Link
          href="/leads"
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
              href={`/customers/${linkedCustomerId}`}
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

        {/* Right column — Activity (2/3) */}
        <section className="lg:col-span-2 space-y-6">

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Add Note</h2>
            <LeadNotesForm leadId={l.id} />
          </div>

          <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-pvx-border flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Activity</h2>
              <span className="text-xs text-gray-500">{rows.length} note{rows.length === 1 ? '' : 's'}</span>
            </div>

            <LeadActivityList activities={feed} />
          </div>
        </section>
      </div>
    </div>
  )
}
