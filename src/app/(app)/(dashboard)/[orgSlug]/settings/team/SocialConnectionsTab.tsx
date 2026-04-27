'use client'

import Link from 'next/link'
import { CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import DisconnectButton from './DisconnectButton'

export type SocialPlatform = 'reddit' | 'x' | 'facebook' | 'threads'

export type CredentialRow = {
  platform:       SocialPlatform
  account_handle: string | null
  status:         string
  expires_at:     string | null
}

export type SocialBannerState = {
  reddit?: 'connected' | 'denied' | 'error' | string
  detail?: string
}

type Props = {
  credentials: CredentialRow[]
  banner:      SocialBannerState
}

type PlatformDef = {
  id:        SocialPlatform
  name:      string
  blurb:     string
  loginPath: string | null
}

// Reddit is the live writer. X/FB/Threads are stubbed with `loginPath: null`
// so the surface is visible but un-clickable until each OAuth flow lands.
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

export default function SocialConnectionsTab({ credentials, banner }: Props) {
  const byPlatform = new Map<SocialPlatform, CredentialRow>()
  for (const row of credentials) byPlatform.set(row.platform, row)

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">Social Connections</h3>
        <p className="mt-1 text-xs text-gray-500">
          Connect the social accounts Kinvox replies from. Tokens are stored
          encrypted in Supabase Vault and never touch the browser. One account
          per platform — disconnecting revokes the credential immediately.
        </p>
      </div>

      <Banner state={banner} />

      <div className="space-y-3">
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
                  <h4 className="text-base font-semibold text-white">{p.name}</h4>
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
      </div>
    </section>
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

function Banner({ state }: { state: SocialBannerState }) {
  if (!state?.reddit) return null

  if (state.reddit === 'connected') {
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

  if (state.reddit === 'denied') {
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

  return (
    <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-3 text-sm text-red-200 flex items-start gap-2">
      <AlertCircle className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Couldn't connect to Reddit.</p>
        <p className="text-xs text-red-300/80 mt-0.5">
          {state.detail ? `Reason: ${state.detail}` : 'Please try again.'}
        </p>
      </div>
    </div>
  )
}
