import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { CREDIT_BUNDLES } from '@/lib/stripe'
import { BuyCreditsButton } from './buy-credits-button'

export const dynamic = 'force-dynamic'

type SearchParams = { status?: string }

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-4 text-neutral-600">
          No organization found for your account.
        </p>
      </main>
    )
  }

  const { data: credits } = await supabase
    .from('organization_credits')
    .select('balance')
    .eq('organization_id', orgId)
    .maybeSingle<{ balance: number }>()

  const balance  = credits?.balance ?? 0
  const status   = params?.status
  const hasAny   = CREDIT_BUNDLES.length > 0

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Billing</h1>

      {status === 'success' && (
        <div className="mt-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
          Payment received. Your new balance will appear once the webhook clears (usually seconds).
        </div>
      )}
      {status === 'cancelled' && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Checkout cancelled — no charge was made.
        </div>
      )}

      <section className="mt-8 rounded border border-neutral-200 p-4">
        <p className="text-sm text-neutral-500">Current balance</p>
        <p className="mt-1 text-3xl font-semibold">{balance.toLocaleString()}<span className="ml-2 text-base font-normal text-neutral-500">credits</span></p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Buy credits</h2>
        {!hasAny ? (
          <p className="mt-4 text-sm text-neutral-600">
            No credit bundles are configured. Set <code className="font-mono">STRIPE_PRICE_STARTER</code>,{' '}
            <code className="font-mono">STRIPE_PRICE_GROWTH</code>, and/or{' '}
            <code className="font-mono">STRIPE_PRICE_SCALE</code> in the environment to enable purchases.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {CREDIT_BUNDLES.map((b) => (
              <li key={b.key} className="flex items-center justify-between rounded border border-neutral-200 p-4">
                <div>
                  <p className="font-medium">{b.label}</p>
                  <p className="text-xs text-neutral-500">Bundle: {b.key}</p>
                </div>
                <BuyCreditsButton bundle={b.key} label={`Buy ${b.label}`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
