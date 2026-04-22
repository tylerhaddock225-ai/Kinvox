import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/auth/tokens'
import ClaimButton from './ClaimButton'

export const dynamic = 'force-dynamic'

type Claim = {
  id:              string
  organization_id: string
  email:           string
  expires_at:      string
  claimed_at:      string | null
  organizations:   { id: string; name: string; slug: string | null } | null
}

export default async function ClaimLandingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Admin client for the lookup — claim rows are HQ-scope in RLS and
  // this page is public. We hash the URL token and match on token_hash;
  // the raw token is never exposed beyond the inbound URL.
  const admin = createAdminClient()
  const { data: claim } = await admin
    .from('organization_claims')
    .select('id, organization_id, email, expires_at, claimed_at, organizations(id, name, slug)')
    .eq('token_hash', hashToken(token))
    .maybeSingle<Claim>()

  // Determine current state — most specific failure wins so the message
  // tells the user what actually happened.
  const now = Date.now()
  const state: 'invalid' | 'claimed' | 'expired' | 'valid' =
    !claim                                        ? 'invalid'
    : claim.claimed_at                            ? 'claimed'
    : new Date(claim.expires_at).getTime() < now  ? 'expired'
    :                                               'valid'

  // Only check the user session when we'd actually show the claim UI —
  // for expired/claimed/invalid we never prompt them to sign in.
  let user: { id: string; email: string | null } | null = null
  if (state === 'valid') {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    user = authUser ? { id: authUser.id, email: authUser.email ?? null } : null
  }

  const orgName = claim?.organizations?.name ?? 'this organization'

  return (
    <main className="min-h-screen flex items-center justify-center bg-pvx-bg px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pvx-border bg-gray-900/80 p-7 shadow-xl">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.25em] text-emerald-400 uppercase">
          <Zap className="w-3.5 h-3.5 fill-emerald-400" />
          Kinvox
        </div>

        {state === 'invalid' && (
          <>
            <div className="mt-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">Claim link not recognized</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  We couldn't find a matching invitation. The link may have been mistyped or the invite may have been revoked. Contact your Kinvox account rep for a fresh link.
                </p>
              </div>
            </div>
          </>
        )}

        {state === 'claimed' && (
          <>
            <div className="mt-6 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">Already claimed</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  <span className="text-gray-200 font-medium">{orgName}</span> has already been claimed. Sign in to access the dashboard.
                </p>
              </div>
            </div>
            <Link
              href="/login"
              className="mt-6 w-full inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              Go to sign in
            </Link>
          </>
        )}

        {state === 'expired' && (
          <>
            <div className="mt-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">This invite has expired</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  Claim links are valid for 7 days. Ask your Kinvox account rep to resend one.
                </p>
              </div>
            </div>
          </>
        )}

        {state === 'valid' && !user && (
          <>
            <h1 className="mt-6 text-xl font-semibold text-white">
              You've been invited to claim <span className="text-emerald-300">{orgName}</span>
            </h1>
            <p className="mt-2 text-sm text-gray-400 leading-relaxed">
              Sign in or create an account to take ownership of this organization on Kinvox. We recommend using <span className="font-mono text-gray-200">{claim?.email}</span> — the address this invite was sent to.
            </p>

            <div className="mt-6 space-y-2">
              <Link
                href={`/signup?email=${encodeURIComponent(claim?.email ?? '')}&returnTo=${encodeURIComponent(`/claim/${token}`)}`}
                className="w-full inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
              >
                Create an account
              </Link>
              <Link
                href={`/login?returnTo=${encodeURIComponent(`/claim/${token}`)}`}
                className="w-full inline-flex items-center justify-center rounded-lg border border-pvx-border bg-pvx-surface hover:bg-pvx-border px-4 py-3 text-sm font-medium text-gray-200 transition-colors"
              >
                I already have an account
              </Link>
            </div>
          </>
        )}

        {state === 'valid' && user && (
          <>
            <h1 className="mt-6 text-xl font-semibold text-white">
              Claim <span className="text-emerald-300">{orgName}</span>
            </h1>
            <p className="mt-2 text-sm text-gray-400 leading-relaxed">
              You're signed in as <span className="font-mono text-gray-200">{user.email ?? 'this account'}</span>. Claiming transfers ownership to you and makes you an admin on the organization.
            </p>
            {user.email && claim?.email && user.email.toLowerCase() !== claim.email.toLowerCase() && (
              <p className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
                Heads up: this invite was sent to <span className="font-mono">{claim.email}</span>, not your current account. Proceed only if you're sure you want to claim it under this login.
              </p>
            )}

            <div className="mt-6">
              <ClaimButton token={token} orgName={orgName} />
            </div>
          </>
        )}

        <p className="mt-8 text-center text-[10px] text-gray-600">
          Powered by Kinvox
        </p>
      </div>
    </main>
  )
}
