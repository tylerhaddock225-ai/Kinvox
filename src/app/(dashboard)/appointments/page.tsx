import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CreateAppointmentModal from '@/components/CreateAppointmentModal'
import CalendarCore, { type CalAppt } from '@/components/calendar/CalendarCore'
import CalendarViewToggle from '@/components/calendar/CalendarViewToggle'
import MiniCalendar from '@/components/calendar/MiniCalendar'

type SearchParamsP = Promise<{ [key: string]: string | string[] | undefined }>

const APPT_COLS = 'id, display_id, title, start_at, end_at, status, description, location, assigned_to, created_by, lead_id'

export default async function AppointmentsPage({ searchParams }: { searchParams: SearchParamsP }) {
  const params   = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const orgId         = profile.organization_id
  const isAdmin       = profile.role === 'admin'
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
    // Creator OR target. PostgREST OR syntax.
    apptsQ = apptsQ.or(`created_by.eq.${user.id},assigned_to.eq.${user.id}`)
  } else if (view === 'agent' && agentParam) {
    apptsQ = apptsQ.eq('assigned_to', agentParam)
  }
  // view === 'global' applies no extra filter; full org list.

  const [apptsRes, membersRes, leadsRes] = await Promise.all([
    apptsQ,
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('organization_id', orgId),
    supabase
      .from('leads')
      .select('id, first_name, last_name')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
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

  const members      = (membersRes.data ?? []) as { id: string; full_name: string | null }[]
  const leads        = (leadsRes.data   ?? []) as { id: string; first_name: string; last_name: string | null }[]

  return (
    <div className="px-8 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-sm text-gray-400 mt-1">Schedule and manage meetings with leads and clients.</p>
        </div>
        <CreateAppointmentModal members={members} leads={leads} />
      </div>

      <CalendarViewToggle members={members} canSeeGlobal={isAdmin} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-6">
        <Suspense fallback={<div className="rounded-xl border border-pvx-border bg-pvx-surface h-96" />}>
          <CalendarCore
            appointments={appointments}
            members={members}
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
