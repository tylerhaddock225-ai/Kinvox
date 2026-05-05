import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  Users, CalendarCheck, Ticket, TrendingUp, Percent,
  CheckCircle2, Clock, type LucideIcon,
} from 'lucide-react'
import type { Lead } from '@/lib/types/database.types'
import { DEFAULT_PERMISSIONS, type Permissions } from '@/lib/permissions'
import { WIDGET_DEFS } from '@/lib/widgets'
import WidgetCustomizer from '@/components/WidgetCustomizer'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import { resolveImpersonation } from '@/lib/impersonation'

// ── Types ────────────────────────────────────────────────────────────────────

type SupportStats = {
  open_count:  number | null
  closed_week: number | null
  avg_hours:   number | null
}

type StatCard = {
  id:    string
  label: string
  value: string
  icon:  LucideIcon
  color: string
  bg:    string
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<Lead['status'], string> = {
  new:            'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  qualified:      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  lost:           'bg-red-500/10 text-red-400 border-red-500/20',
  converted:      'bg-purple-500/10 text-purple-400 border-purple-500/20',
  pending_unlock: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<{ impersonate?: string }>
}) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { orgSlug } = await params
  const { impersonate } = await searchParams
  const impersonation = await resolveImpersonation(impersonate)

  // Fetch profile (with role permissions) + widget config in one wave
  const [profileRes, dashConfigRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id, full_name, role, roles(permissions)')
      .eq('id', user.id)
      .single(),
    supabase
      .from('user_dashboard_configs')
      .select('hidden_widgets')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const profileData = profileRes.data as {
    organization_id: string | null
    full_name:       string | null
    role:            string
    roles:           unknown
  } | null

  if (profileRes.error || !profileData?.organization_id) redirect('/onboarding')

  // When a verified HQ admin is impersonating, queries target the impersonated org.
  // Otherwise fall back to the caller's real org — RLS enforces both sides.
  const orgId = impersonation.active ? impersonation.orgId : profileData.organization_id

  // URL-slug verification: the `/:orgSlug` segment must match the effective org.
  // If it doesn't, redirect to the correct slug rather than render misleading
  // data under the wrong URL. (Admins without impersonation are pinned to their
  // own slug — URL-based org switching goes through the impersonation cookie.)
  const { data: effectiveOrg } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .single<{ slug: string | null }>()

  if (effectiveOrg?.slug && effectiveOrg.slug !== orgSlug) {
    redirect(`/${effectiveOrg.slug}`)
  }

  // Resolve permissions from the joined role (fall back to full access)
  const rawPerms = (profileData.roles as { permissions: Record<string, boolean> } | null)?.permissions
  const permissions: Permissions = rawPerms
    ? ({ ...DEFAULT_PERMISSIONS, ...rawPerms } as Permissions)
    : DEFAULT_PERMISSIONS

  const hiddenWidgets   = (dashConfigRes.data?.hidden_widgets ?? []) as string[]
  const canViewLeads    = permissions.view_leads    !== false
  const canViewTickets  = permissions.view_tickets  !== false

  // Row-type counts need head+count queries so we don't derive totals from
  // the display-sized slices below. ISO string is stable across the server
  // + Postgres timestamptz comparison.
  const nowIso = new Date().toISOString()

  const [
    recentLeadsRes,
    totalLeadsRes,
    customerCountRes,
    supportRes,
    upcomingApptsCountRes,
    upcomingApptsRes,
  ] = await Promise.all([
    canViewLeads
      ? supabase
          .from('leads')
          .select('id, first_name, last_name, company, status, source, created_at')
          .eq('organization_id', orgId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),

    canViewLeads
      ? supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .is('deleted_at', null)
      : Promise.resolve({ count: 0, error: null }),

    canViewLeads
      ? supabase
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .is('deleted_at', null)
          .is('archived_at', null)
      : Promise.resolve({ count: 0, error: null }),

    canViewTickets
      ? supabase.rpc('get_support_stats', { p_org_id: orgId })
      : Promise.resolve({ data: [], error: null }),

    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .gt('start_at', nowIso),

    supabase
      .from('appointments')
      .select('id, title, start_at, location, status')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .gt('start_at', nowIso)
      .order('start_at', { ascending: true })
      .limit(5),
  ])

  const leads           = (recentLeadsRes.data ?? []) as Lead[]
  const totalLeads      = totalLeadsRes.count    ?? 0
  const customerCount   = customerCountRes.count ?? 0
  const supportArr      = (supportRes.data ?? []) as SupportStats[]
  const ss              = supportArr[0] ?? { open_count: 0, closed_week: 0, avg_hours: null }
  const upcomingCount   = upcomingApptsCountRes.count ?? 0
  const upcomingAppts   = (upcomingApptsRes.data ?? []) as Array<{
    id:        string
    title:     string
    start_at:  string
    location:  string | null
    status:    'scheduled' | 'completed' | 'cancelled'
  }>

  // Conversion Rate = alive customers / total leads. Guarded so a fresh
  // org with zero leads displays 0% instead of NaN.
  const conversionRate = totalLeads > 0
    ? Math.round((customerCount / totalLeads) * 100)
    : 0

  // Build the full set of permitted stat cards
  const allCards: StatCard[] = []

  if (canViewLeads) {
    allCards.push(
      { id: 'total_leads',     label: 'Total Leads',     value: String(totalLeads),       icon: Users,       color: 'text-indigo-400',  bg: 'bg-indigo-500/10'  },
      { id: 'converted_leads', label: 'Converted',       value: String(customerCount),    icon: TrendingUp,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
      { id: 'conversion_rate', label: 'Conversion Rate', value: `${conversionRate}%`,     icon: Percent,     color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10' },
    )
  }

  if (canViewTickets) {
    allCards.push(
      {
        id:    'open_tickets',
        label: 'Open Tickets',
        value: String(ss.open_count  ?? 0),
        icon:  Ticket,
        color: 'text-amber-400',
        bg:    'bg-amber-500/10',
      },
      {
        id:    'tickets_closed_week',
        label: 'Closed This Week',
        value: String(ss.closed_week ?? 0),
        icon:  CheckCircle2,
        color: 'text-teal-400',
        bg:    'bg-teal-500/10',
      },
      {
        id:    'avg_resolution_time',
        label: 'Avg Resolution',
        value: ss.avg_hours != null ? `${ss.avg_hours}h` : '\u2014',
        icon:  Clock,
        color: 'text-rose-400',
        bg:    'bg-rose-500/10',
      },
    )
  }

  allCards.push(
    { id: 'appointments', label: 'Appointments', value: String(upcomingCount), icon: CalendarCheck, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  )

  // Apply user's hidden-widget preferences
  const visibleCards = allCards.filter(c => !hiddenWidgets.includes(c.id))

  // Widget defs scoped to what this user can see (for the customizer)
  const permittedWidgetDefs = WIDGET_DEFS.filter(w => allCards.some(c => c.id === w.id))

  return (
    <>
      {impersonation.active && <ImpersonationBanner orgName={impersonation.orgName} />}
      <div className="px-8 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">
            Welcome back{profileData.full_name ? `, ${profileData.full_name}` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WidgetCustomizer allWidgets={permittedWidgetDefs} hiddenWidgets={hiddenWidgets} />
        </div>
      </div>

      {/* Stat cards */}
      {visibleCards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {visibleCards.map(({ id, label, value, icon: Icon, color, bg }) => (
            <div key={id} className="rounded-xl border border-pvx-border bg-gray-900 p-5 flex items-center gap-4">
              <div className={`p-3 rounded-lg ${bg}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-2xl font-semibold text-white">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleCards.length === 0 && (
        <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface p-10 text-center text-gray-500 text-sm">
          All widgets are hidden. Click <strong className="text-gray-400">Customize</strong> to restore them.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Leads */}
        {canViewLeads && (
          <div className="rounded-xl border border-pvx-border bg-gray-900 overflow-hidden">
            <div className="px-6 py-4 border-b border-pvx-border">
              <h2 className="text-sm font-semibold text-white">Recent Leads</h2>
            </div>

            {leads.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-500 text-sm">
                No leads yet. Add your first lead to get started.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-pvx-border">
                    <th className="px-6 py-3 text-left font-medium">Name</th>
                    <th className="px-6 py-3 text-left font-medium">Company</th>
                    <th className="px-6 py-3 text-left font-medium">Source</th>
                    <th className="px-6 py-3 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pvx-border">
                  {leads.map(lead => (
                    <tr key={lead.id} className="hover:bg-violet-400/[0.05] transition-colors">
                      <td className="px-6 py-3 text-gray-200 font-medium">
                        {lead.first_name} {lead.last_name ?? ''}
                      </td>
                      <td className="px-6 py-3 text-gray-400">{lead.company ?? '\u2014'}</td>
                      <td className="px-6 py-3 text-gray-400 capitalize">{lead.source ?? '\u2014'}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_COLORS[lead.status]}`}>
                          {lead.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Upcoming Appointments */}
        <div className="rounded-xl border border-pvx-border bg-gray-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-pvx-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Upcoming Appointments</h2>
            <Link href={`/${orgSlug}/appointments`} className="text-xs text-violet-300 hover:text-violet-200 transition-colors">
              View all \u2192
            </Link>
          </div>

          {upcomingAppts.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              No upcoming appointments.
            </div>
          ) : (
            <ul className="divide-y divide-pvx-border">
              {upcomingAppts.map(a => {
                const when = new Date(a.start_at)
                return (
                  <li key={a.id} className="px-6 py-3 hover:bg-violet-400/[0.05] transition-colors">
                    <Link href={`/${orgSlug}/appointments?open=${a.id}`} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-200 font-medium truncate">{a.title}</p>
                        {a.location && <p className="text-xs text-gray-500 truncate">{a.location}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-gray-300">
                          {when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      </div>
    </>
  )
}
