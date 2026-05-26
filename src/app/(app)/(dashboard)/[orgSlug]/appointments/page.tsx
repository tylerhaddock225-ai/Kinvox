import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import CreateAppointmentModal from '@/components/CreateAppointmentModal'
import CalendarCore, { type CalAppt } from '@/components/calendar/CalendarCore'
import CalendarViewToggle from '@/components/calendar/CalendarViewToggle'
import MiniCalendar from '@/components/calendar/MiniCalendar'

type SearchParamsP = Promise<{ [key: string]: string | string[] | undefined }>

const APPT_COLS = 'id, display_id, title, start_at, end_at, status, description, location, assigned_to, created_by, lead_id, customer_id'

export default async function AppointmentsPage({ searchParams }: { searchParams: SearchParamsP }) {
  const params   = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; role: string | null }>(),
    resolveImpersonation(),
  ])

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  const orgId         = effectiveOrgId
  // HQ admins impersonating a tenant are treated as admins of that tenant
  // for view-toggle purposes — their intent is to assist, and RLS still
  // enforces the actual write boundaries downstream.
  const isAdmin       = impersonation.active || profile?.role === 'admin'
  const openId        = typeof params.open    === 'string' ? params.open    : null
  const requestedView = typeof params.view    === 'string' ? params.view    : null
  const agentParam    = typeof params.agent   === 'string' ? params.agent   : null

  // Resolve the view: anyone can see Mine + By-agent; Global is admin-only.
  const view: 'mine' | 'agent' | 'global' =
      requestedView === 'global' && isAdmin ? 'global'
    : requestedView === 'agent'             ? 'agent'
    :                                         'mine'

  let apptsQ = supabase
    .from('appointments')
    .select(APPT_COLS)
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('start_at', { ascending: true })
    .limit(1000)

  if (view === 'mine') {
    // "Mine" = appointments where I am the agent (target). Workstream F:
    // creator-or-target was widening the view to include lead-magnet
    // appointments only because the owner was the created_by surrogate —
    // those now belong to the Lead Email pseudo-agent, so filter strictly
    // by assigned_to.
    apptsQ = apptsQ.eq('assigned_to', user.id)
  } else if (view === 'agent' && agentParam) {
    apptsQ = apptsQ.eq('assigned_to', agentParam)
  }
  // view === 'global' applies no extra filter; full org list.

  const [apptsRes, membersRes, customersRes, leadsRes] = await Promise.all([
    apptsQ,
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
    // Active, non-archived, non-converted leads for the modal's Lead picker.
    // Converted leads have a companion customer row — the customer picker
    // is the right surface for them, not the lead picker.
    supabase
      .from('leads')
      .select('id, display_id, first_name, last_name, email')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .neq('status', 'converted')
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  let appointments = (apptsRes.data ?? []) as CalAppt[]

  // If the URL targets a specific appointment, make sure it's present even if
  // it fell outside the default window (e.g. far past/future beyond the limit).
  if (openId && !appointments.some(a => a.id === openId)) {
    const { data: target } = await supabase
      .from('appointments')
      .select(APPT_COLS)
      .eq('id', openId)
      .is('deleted_at', null)
      .maybeSingle()
    if (target) appointments = [...appointments, target as CalAppt]
  }

  const members   = (membersRes.data   ?? []) as { id: string; full_name: string | null }[]
  const customers = (customersRes.data ?? []) as { id: string; first_name: string; last_name: string | null; email: string | null }[]
  const leads     = (leadsRes.data     ?? []) as { id: string; display_id: string | null; first_name: string | null; last_name: string | null; email: string | null }[]

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-sm text-gray-400 mt-1">Schedule and manage meetings with leads and clients.</p>
        </div>
        <CreateAppointmentModal members={members} customers={customers} leads={leads} />
      </div>

      <CalendarViewToggle members={members} canSeeGlobal={isAdmin} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-6">
        <Suspense fallback={<div className="rounded-xl border border-pvx-border bg-pvx-surface h-96" />}>
          <CalendarCore
            appointments={appointments}
            members={members}
            customers={customers}
            leads={leads}
            colorByAgent={view === 'global'}
          />
        </Suspense>
        <aside className="space-y-4">
          <MiniCalendar appointments={appointments} />
        </aside>
      </div>
    </div>
  )
}
