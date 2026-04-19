import { createClient } from '@/lib/supabase/server'
import { DollarSign, TrendingUp, Users, Wallet } from 'lucide-react'

export const dynamic = 'force-dynamic'

type PlanKey = 'free' | 'pro' | 'enterprise'

// Placeholder pricing used for "expected MRR" until Stripe is wired.
const PLAN_PRICE: Record<PlanKey, number> = {
  free:       0,
  pro:        49,
  enterprise: 199,
}

export default async function AdminBillingPage() {
  const supabase = await createClient()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, plan, status, created_at')
    .is('deleted_at', null)
    .returns<Array<{ id: string; name: string; plan: PlanKey | null; status: string | null; created_at: string }>>()

  const rows = orgs ?? []
  const planCounts: Record<PlanKey, number> = { free: 0, pro: 0, enterprise: 0 }
  for (const o of rows) {
    const plan = (o.plan ?? 'free') as PlanKey
    planCounts[plan] = (planCounts[plan] ?? 0) + 1
  }

  const expectedMrr =
    planCounts.pro * PLAN_PRICE.pro +
    planCounts.enterprise * PLAN_PRICE.enterprise

  return (
    <div className="space-y-6">
      <header>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Billing
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Revenue</h1>
        <p className="mt-1 text-sm text-gray-400">
          Placeholder view — wire this to Stripe to replace <span className="text-gray-300">“expected”</span> numbers with real charges.
        </p>
      </header>

      <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
        Stripe integration pending. Figures below are derived from plan counts × static placeholder prices.
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat
          label="Expected MRR"
          value={`$${expectedMrr.toLocaleString()}`}
          icon={DollarSign}
          hint={`${planCounts.pro} × $${PLAN_PRICE.pro} + ${planCounts.enterprise} × $${PLAN_PRICE.enterprise}`}
        />
        <Stat
          label="Paying Orgs"
          value={String(planCounts.pro + planCounts.enterprise)}
          icon={Users}
          hint={`${planCounts.free} on free`}
        />
        <Stat
          label="Expected ARR"
          value={`$${(expectedMrr * 12).toLocaleString()}`}
          icon={TrendingUp}
        />
      </section>

      <section className="rounded-xl border border-pvx-border bg-gray-900 shadow-sm">
        <header className="px-5 py-3 border-b border-pvx-border flex items-center gap-2">
          <Wallet className="w-4 h-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">Organizations by plan</h2>
        </header>
        <table className="w-full text-sm">
          <thead className="bg-pvx-surface/80 border-b border-pvx-border">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <th className="px-5 py-3">Plan</th>
              <th className="px-5 py-3">Count</th>
              <th className="px-5 py-3 text-right">Placeholder MRR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pvx-border">
            {(['pro', 'enterprise', 'free'] as const).map(plan => (
              <tr key={plan} className="hover:bg-violet-400/[0.05] transition-colors">
                <td className="px-5 py-3 text-gray-100 font-medium capitalize">{plan}</td>
                <td className="px-5 py-3 text-gray-300">{planCounts[plan] ?? 0}</td>
                <td className="px-5 py-3 text-right text-gray-300 font-mono">
                  ${((planCounts[plan] ?? 0) * PLAN_PRICE[plan]).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  hint,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-pvx-border bg-gray-900 p-5 shadow-sm transition-all hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/15">
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</div>
        <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300 ring-1 ring-inset ring-violet-500/20">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-gray-500">{hint}</div>}
    </div>
  )
}
