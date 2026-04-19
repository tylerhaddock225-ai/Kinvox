import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Mail, Phone, Building2, User, Calendar, Ticket as TicketIcon, CalendarCheck, Archive, RotateCcw, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Customer, Ticket, Appointment } from '@/lib/types/database.types'
import CustomerStatusSelect from '@/components/CustomerStatusSelect'
import CustomerNotesForm from '@/components/CustomerNotesForm'
import LeadActivityList, { type Activity } from '@/components/LeadActivityList'
import EditCustomerModal from '@/components/EditCustomerModal'
import CopyId from '@/components/CopyId'
import QuickScheduleModal from '@/components/QuickScheduleModal'
import ConfirmButton from '@/components/admin/ConfirmButton'
import { archiveCustomer, restoreCustomer } from '@/app/(dashboard)/actions/customers'
import type { CustomerStatus } from '@/app/(dashboard)/actions/customers'

type CustomerRowWithStatus = Customer & { status: CustomerStatus | null }

type ActivityRow = {
  id:         string
  content:    string
  created_at: string
  user_id:    string
  profiles:   { full_name: string | null; avatar_url: string | null } | null
}

type TicketRow = Pick<Ticket, 'id' | 'display_id' | 'subject' | 'status' | 'updated_at'>
type ApptRow   = Pick<Appointment, 'id' | 'display_id' | 'title' | 'start_at' | 'status'>

const TICKET_STATUS_COLORS: Record<Ticket['status'], string> = {
  open:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  closed:  'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const APPT_STATUS_COLORS: Record<Appointment['status'], string> = {
  scheduled: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  completed: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
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

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const { data: customerData } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!customerData) notFound()
  const c = customerData as CustomerRowWithStatus
  const currentStatus: CustomerStatus = (c.status ?? 'active') as CustomerStatus
  const isArchived = !!c.archived_at

  // Activity feed + related records in a single round trip
  const [actsRes, ticketsRes, apptsRes] = await Promise.all([
    supabase
      .from('customer_activities')
      .select('id, content, created_at, user_id, profiles(full_name, avatar_url)')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('tickets')
      .select('id, display_id, subject, status, updated_at')
      .eq('customer_id', id)
      .eq('is_platform_support', false)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('appointments')
      .select('id, display_id, title, start_at, status')
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('start_at', { ascending: false })
      .limit(50),
  ])

  const rows = (actsRes.data ?? []) as unknown as ActivityRow[]
  const feed: Activity[] = rows.map(a => ({
    id:         a.id,
    content:    a.content,
    created_at: a.created_at,
    author:     a.profiles?.full_name ?? null,
  }))

  const tickets = (ticketsRes.data ?? []) as TicketRow[]
  const appts   = (apptsRes.data   ?? []) as ApptRow[]

  const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'

  return (
    <div className="px-8 py-8 space-y-6">
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Customers
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-white truncate flex items-center gap-3">
            <span className="truncate">
              {fullName}
              {c.company && (
                <span className="ml-3 text-xl font-normal text-gray-400">{c.company}</span>
              )}
            </span>
            {isArchived && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/60 bg-amber-950/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-300 shrink-0">
                <Archive className="w-3 h-3" />
                Archived
              </span>
            )}
          </h1>
          <div className="shrink-0">
            <QuickScheduleModal customerId={c.id} />
          </div>
        </div>
        {c.display_id && (
          <div className="mt-0.5 text-xs">
            <CopyId id={c.display_id} />
          </div>
        )}
        {c.lead_id && (
          <div className="mt-1">
            <Link
              href={`/leads/${c.lead_id}`}
              className="text-violet-400 hover:text-violet-300 text-xs font-medium transition-colors"
            >
              View Lead Profile →
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column — Info (1/3) */}
        <aside className="lg:col-span-1 space-y-6">

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</h2>
            <CustomerStatusSelect customerId={c.id} initialStatus={currentStatus} />
          </div>

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Details</h2>
              <EditCustomerModal customer={c} />
            </div>

            <div className="space-y-3">
              <Field icon={User}       label="Name"    value={fullName} />
              <Field icon={Building2}  label="Company" value={c.company} />
              <Field icon={Mail}       label="Email"   value={c.email} />
              <Field icon={Phone}      label="Phone"   value={c.phone} />
              <Field icon={Calendar}   label="Created" value={new Date(c.created_at).toLocaleDateString()} />
            </div>
          </div>

          {/* Related records — kept condensed in left column */}
          {(tickets.length > 0 || appts.length > 0) && (
            <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Related</h2>

              {tickets.length > 0 && (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                    <TicketIcon className="w-3 h-3 text-violet-400" />
                    Tickets ({tickets.length})
                  </h3>
                  <ul className="space-y-1">
                    {tickets.slice(0, 5).map(t => (
                      <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                        <Link href={`/tickets/${t.id}`} className="text-gray-200 hover:text-violet-300 truncate">
                          {t.subject}
                        </Link>
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border capitalize ${TICKET_STATUS_COLORS[t.status]}`}>
                          {t.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {appts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                    <CalendarCheck className="w-3 h-3 text-violet-400" />
                    Appointments ({appts.length})
                  </h3>
                  <ul className="space-y-1">
                    {appts.slice(0, 5).map(a => (
                      <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                        <Link href={`/appointments?open=${a.id}`} className="text-gray-200 hover:text-violet-300 truncate">
                          {a.title}
                        </Link>
                        <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border capitalize ${APPT_STATUS_COLORS[a.status]}`}>
                          {a.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Right column — Activity (2/3) */}
        <section className="lg:col-span-2 space-y-6">

          <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">Add Note</h2>
            <CustomerNotesForm customerId={c.id} />
          </div>

          <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
            <div className="px-5 py-4 border-b border-pvx-border flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Activity</h2>
              <span className="text-xs text-gray-500">{rows.length} note{rows.length === 1 ? '' : 's'}</span>
            </div>

            <LeadActivityList activities={feed} />
          </div>

          {/* Danger Zone \u2014 mirrors the Admin HQ org-archive pattern. */}
          <section className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-rose-200">Danger Zone</h2>
            </div>

            {!isArchived ? (
              <>
                <p className="mt-2 text-xs text-rose-300/70">
                  Archiving hides this customer from the default list. Related tickets and appointments keep their link, and you can restore at any time.
                </p>
                <form action={archiveCustomer} className="mt-4">
                  <input type="hidden" name="customer_id" value={c.id} />
                  <ConfirmButton
                    message={`Archive "${fullName}"? You can restore them from the archived list.`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/60 bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/50 transition-colors"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive customer
                  </ConfirmButton>
                </form>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-rose-300/70">
                  This customer is currently archived. Restore to bring them back into the default list.
                </p>
                <form action={restoreCustomer} className="mt-4">
                  <input type="hidden" name="customer_id" value={c.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore customer
                  </button>
                </form>
              </>
            )}
          </section>
        </section>
      </div>
    </div>
  )
}
