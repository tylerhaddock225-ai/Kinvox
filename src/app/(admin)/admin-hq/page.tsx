import Link from 'next/link'
import { Building2, Ticket, Activity } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

type SystemRole = 'platform_owner' | 'platform_support'

export const dynamic = 'force-dynamic'

export default async function AdminHqOverviewPage() {
  const supabase = await createClient()

  const [{ data: { user } }] = await Promise.all([supabase.auth.getUser()])

  const [profileResp, orgsCountResp, ticketsCountResp] = await Promise.all([
    supabase
      .from('profiles')
      .select('system_role')
      .eq('id', user!.id)
      .single<{ system_role: SystemRole | null }>(),
    supabase
      .from('organizations')
      .select('*', { count: 'exact', head: true })
      .is('deleted_at', null),
    supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .in('status', ['open', 'pending']),
  ])

  const systemRole = profileResp.data?.system_role ?? 'platform_support'
  const roleLabel = systemRole === 'platform_owner' ? 'Platform Owner' : 'Platform Support'
  const orgsCount = orgsCountResp.count ?? 0
  const activeTicketsCount = ticketsCountResp.count ?? 0

  return (
    <div className="space-y-8">
      <header>
        <div className="text-[10px] font-bold tracking-[0.2em] text-indigo-400 uppercase">
          Command Center
        </div>
        <h1 className="mt-1 text-3xl font-semibold text-slate-50">
          Welcome back, {roleLabel}.
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Platform-wide snapshot of Kinvox operations.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          label="Total Organizations"
          value={orgsCount.toLocaleString()}
          icon={Building2}
          href="/admin-hq/organizations"
          cta="Manage organizations"
        />
        <SummaryCard
          label="Active Tickets"
          value={activeTicketsCount.toLocaleString()}
          icon={Ticket}
          href="/admin-hq/tickets"
          cta="Review queue"
          hint="open + pending"
        />
        <SystemStatusCard />
      </section>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  href,
  cta,
  hint,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  cta: string
  hint?: string
}) {
  return (
    <div className="group rounded-xl border border-slate-800 bg-slate-950/60 p-5 shadow-sm hover:border-indigo-500/40 transition-colors">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
        </div>
        <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-300 ring-1 ring-inset ring-indigo-500/20">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <div className="text-3xl font-semibold text-slate-50">{value}</div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
      <Link
        href={href}
        className="mt-4 inline-flex items-center text-xs font-medium text-indigo-300 hover:text-indigo-200"
      >
        {cta} →
      </Link>
    </div>
  )
}

function SystemStatusCard() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
          System Status
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
          <Activity className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-xl font-semibold text-slate-50">Operational</span>
      </div>
      <div className="mt-4 text-xs text-slate-500">
        All services reporting normal.
      </div>
    </div>
  )
}
