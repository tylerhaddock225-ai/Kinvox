import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import { Button, buttonVariants } from '@/components/ui/button'
import HuntingProfileForm from './HuntingProfileForm'
import DisconnectButton from './DisconnectButton'

export const dynamic = 'force-dynamic'

type Platform = 'reddit' | 'x' | 'facebook' | 'threads'

type CredentialRow = {
  platform:       Platform
  account_handle: string | null
  status:         string
  expires_at:     string | null
}

type PlatformDef = {
  id:        Platform
  name:      string
  blurb:     string
  loginPath: string | null    // null = "Coming soon"
}

// Reddit is the only writer we ship in this sprint — the rest are stubbed
// so the surface is visible but un-clickable. Each will get its own
// /api/auth/social/<p>/login route as those flows are built.
const PLATFORMS: PlatformDef[] = [
  {
    id:        'reddit',
    name:      'Reddit',
    blurb:     'Reply to high-intent posts directly from approved drafts.',
    loginPath: '/api/auth/social/reddit/login',
  },
  { id: 'x',        name: 'X (Twitter)', blurb: 'Reply to mentions and quote tweets.',         loginPath: null },
  { id: 'facebook', name: 'Facebook',    blurb: 'Engage from your verified business page.',    loginPath: null },
  { id: 'threads',  name: 'Threads',     blurb: 'Mirror replies into your Threads presence.',  loginPath: null },
]

type SearchParams = { reddit?: string; detail?: string }

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
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
  if (!impersonation.active && profile?.role !== 'admin') redirect('/')

  // Column-level grants on organization_credentials hide secret_id from
  // authenticated callers — we only ever read the metadata fields here.
  // The primary signal_configs row (oldest active for the org) backs the
  // hunting profile section. We also need the org's vertical so the
  // form can display it and the upsert path can populate vertical when
  // inserting a brand-new config row.
  const [{ data: creds }, { data: org }, { data: primaryConfig }] = await Promise.all([
    supabase
      .from('organization_credentials')
      .select('platform, account_handle, status, expires_at')
      .eq('organization_id', effectiveOrgId)
      .returns<CredentialRow[]>(),
    supabase
      .from('organizations')
      .select('vertical')
      .eq('id', effectiveOrgId)
      .single<{ vertical: string | null }>(),
    supabase
      .from('signal_configs')
      .select('id, office_address, radius_miles, keywords')
      .eq('organization_id', effectiveOrgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{
        id:             string
        office_address: string | null
        radius_miles:   number
        keywords:       string[]
      }>(),
  ])

  const byPlatform = new Map<Platform, CredentialRow>()
  for (const row of creds ?? []) byPlatform.set(row.platform, row)

  const banner = renderBanner(params)

  return (
    <div className="px-8 py-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Signal &amp; Social Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Tune what Kinvox listens for and which social accounts it can reply
          from. Tokens are stored encrypted in Supabase Vault and never touch
          the browser.
        </p>
      </div>

      {banner}

      {/* Part A — Searchlight (Hunting Profile) */}
      <HuntingProfileForm
        orgVertical={org?.vertical ?? null}
        initialAddress={primaryConfig?.office_address ?? null}
        initialRadius={primaryConfig?.radius_miles ?? 25}
        initialKeywords={primaryConfig?.keywords ?? []}
      />

      {/* Part B — Connectivity Hub */}
      <div className="pt-2">
        <h2 className="text-base font-semibold text-white">Connected Accounts</h2>
        <p className="mt-1 text-xs text-gray-500">
          One account per platform. Disconnecting revokes the credential
          immediately — Kinvox stops being able to reply on your behalf until you reconnect.
        </p>
      </div>

      <section className="space-y-3">
        {PLATFORMS.map((p) => {
          const cred      = byPlatform.get(p.id) ?? null
          const connected = cred?.status === 'active'

          return (
            <div
              key={p.id}
              className="rounded-xl border border-pvx-border bg-gray-900 p-5 flex items-start justify-between gap-6"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white">{p.name}</h2>
                  <StatusPill connected={connected} comingSoon={p.loginPath === null} />
                </div>
                <p className="mt-1 text-sm text-gray-400">{p.blurb}</p>
                {connected && cred?.account_handle && (
                  <p className="mt-2 text-xs text-emerald-300">
                    Connected as <span className="font-mono">{cred.account_handle}</span>
                  </p>
                )}
                {connected && !cred?.account_handle && (
                  <p className="mt-2 text-xs text-emerald-300">Connected</p>
                )}
                {!connected && p.loginPath !== null && (
                  <p className="mt-2 text-xs text-gray-500">Not connected</p>
                )}
              </div>

              <div className="shrink-0 flex flex-col items-end gap-2">
                {p.loginPath === null ? (
                  <Button variant="outline" size="sm" disabled>
                    Coming soon
                  </Button>
                ) : (
                  <>
                    <Link
                      href={p.loginPath}
                      prefetch={false}
                      className={buttonVariants({
                        variant: connected ? 'outline' : 'default',
                        size:    'sm',
                      })}
                    >
                      {connected ? 'Reconnect' : 'Connect'}
                      <ExternalLink className="ml-1.5" />
                    </Link>
                    {connected && <DisconnectButton platform={p.id} />}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function StatusPill({
  connected,
  comingSoon,
}: {
  connected:  boolean
  comingSoon: boolean
}) {
  if (comingSoon) {
    return (
      <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
        Soon
      </span>
    )
  }
  if (connected) {
    return (
      <span className="rounded-full border border-emerald-700/60 bg-emerald-900/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
        Connected
      </span>
    )
  }
  return (
    <span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
      Off
    </span>
  )
}

function renderBanner(params: SearchParams) {
  if (!params?.reddit) return null

  if (params.reddit === 'connected') {
    return (
      <div className="rounded-lg border border-emerald-700/60 bg-emerald-900/20 p-3 text-sm text-emerald-200 flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Reddit connected.</p>
          <p className="text-xs text-emerald-300/80 mt-0.5">
            You can now Approve &amp; Send replies from your Signals queue.
          </p>
        </div>
      </div>
    )
  }

  if (params.reddit === 'denied') {
    return (
      <div className="rounded-lg border border-amber-700/60 bg-amber-900/20 p-3 text-sm text-amber-200 flex items-start gap-2">
        <AlertCircle className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Reddit connection cancelled.</p>
          <p className="text-xs text-amber-300/80 mt-0.5">
            Nothing was saved — try again whenever you're ready.
          </p>
        </div>
      </div>
    )
  }

  // anything else → generic error
  return (
    <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-3 text-sm text-red-200 flex items-start gap-2">
      <AlertCircle className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Couldn't connect to Reddit.</p>
        <p className="text-xs text-red-300/80 mt-0.5">
          {params.detail ? `Reason: ${params.detail}` : 'Please try again.'}
        </p>
      </div>
    </div>
  )
}
