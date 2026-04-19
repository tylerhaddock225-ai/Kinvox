import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Mail, Phone, Building2, ArrowLeft, Ticket as TicketIcon, CalendarCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Customer, Ticket, Appointment } from '@/lib/types/database.types'
import CopyId from '@/components/CopyId'

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

type TicketRow = Pick<Ticket, 'id' | 'display_id' | 'subject' | 'status' | 'priority' | 'updated_at'>
type ApptRow   = Pick<Appointment, 'id' | 'display_id' | 'title' | 'start_at' | 'end_at' | 'status' | 'location'>

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
    .select('id, display_id, first_name, last_name, email, phone, company, notes, created_at, lead_id, organization_id')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .is('deleted_at', null)
    .single()

  if (!customerData) notFound()
  const customer = customerData as Customer

  const [ticketsRes, apptsRes] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, display_id, subject, status, priority, updated_at')
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('appointments')
      .select('id, display_id, title, start_at, end_at, status, location')
      .eq('customer_id', id)
      .is('deleted_at', null)
      .order('start_at', { ascending: false })
      .limit(100),
  ])

  const tickets = (ticketsRes.data ?? []) as TicketRow[]
  const appts   = (apptsRes.data   ?? []) as ApptRow[]

  const fullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
        <ArrowLeft className="w-3 h-3" />
        Back to Customers
      </Link>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">{fullName}</h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
          <CopyId id={customer.display_id} />
          {customer.email && (
            <span className="inline-flex items-center gap-1">
              <Mail className="w-3 h-3" /> {customer.email}
            </span>
          )}
          {customer.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3 h-3" /> {customer.phone}
            </span>
          )}
          {customer.company && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-3 h-3" /> {customer.company}
            </span>
          )}
          {customer.lead_id && (
            <Link href={`/leads/${customer.lead_id}`} className="text-violet-400 hover:text-violet-300 underline decoration-dotted underline-offset-4">
              View source lead
            </Link>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <TicketIcon className="w-4 h-4 text-violet-400" />
          Tickets
          <span className="text-xs text-gray-500 font-normal">({tickets.length})</span>
        </h2>

        {tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface/30 px-6 py-8 text-center text-sm text-gray-500">
            No tickets for this customer yet.
          </div>
        ) : (
          <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                  <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                  <th className="px-3 py-3 text-left font-medium">Subject</th>
                  <th className="px-3 py-3 text-left font-medium">Status</th>
                  <th className="px-3 py-3 pr-6 text-left font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pvx-border">
                {tickets.map(t => (
                  <tr key={t.id} className="hover:bg-violet-400/[0.07] transition-colors">
                    <td className="pl-6 pr-3 py-3 text-xs">
                      <CopyId id={t.display_id} />
                    </td>
                    <td className="px-3 py-3 text-gray-200">
                      <Link href={`/tickets/${t.id}`} className="hover:text-violet-400 transition-colors">
                        {t.subject}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${TICKET_STATUS_COLORS[t.status]}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 pr-6 text-gray-500">
                      {new Date(t.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-300">
          <CalendarCheck className="w-4 h-4 text-violet-400" />
          Appointments
          <span className="text-xs text-gray-500 font-normal">({appts.length})</span>
        </h2>

        {appts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface/30 px-6 py-8 text-center text-sm text-gray-500">
            No appointments for this customer yet.
          </div>
        ) : (
          <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-pvx-border bg-pvx-bg/40">
                  <th className="pl-6 pr-3 py-3 text-left font-medium w-28">ID</th>
                  <th className="px-3 py-3 text-left font-medium">Title</th>
                  <th className="px-3 py-3 text-left font-medium">Status</th>
                  <th className="px-3 py-3 pr-6 text-left font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pvx-border">
                {appts.map(a => (
                  <tr key={a.id} className="hover:bg-violet-400/[0.07] transition-colors">
                    <td className="pl-6 pr-3 py-3 text-xs">
                      <CopyId id={a.display_id} />
                    </td>
                    <td className="px-3 py-3 text-gray-200">
                      <Link href={`/appointments?open=${a.id}`} className="hover:text-violet-400 transition-colors">
                        {a.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${APPT_STATUS_COLORS[a.status]}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 pr-6 text-gray-500">
                      {new Date(a.start_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {customer.notes && (
        <section className="rounded-xl border border-pvx-border bg-pvx-surface/50 p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Notes</h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{customer.notes}</p>
        </section>
      )}
    </div>
  )
}
