import { AlertTriangle, Zap } from 'lucide-react'
import { resolveSmsOptInToken, isOptInKind } from '@/lib/sms/opt-in'
import { formatPhoneDisplay } from '@/lib/phone'
import SmsOptInForm from './SmsOptInForm'

export const dynamic = 'force-dynamic'

// Public SMS opt-in landing (SMS Stage 2a). Reached from a link in a confirmation
// email. Resolves the single-purpose token (admin client — no session, no RLS
// SELECT path on the token) and shows a one-tap consent form. An invalid or
// already-consumed token renders a neutral "no longer valid" state — no leak of
// whether a given token ever existed.
export default async function SmsOptInPage({
  params,
}: {
  params: Promise<{ kind: string; token: string }>
}) {
  const { kind, token } = await params

  const resolved = isOptInKind(kind) ? await resolveSmsOptInToken(kind, token) : null

  return (
    <main className="min-h-screen flex items-center justify-center bg-pvx-bg px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pvx-border bg-gray-900/80 p-7 shadow-xl">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.25em] text-emerald-400 uppercase">
          <Zap className="w-3.5 h-3.5 fill-emerald-400" />
          Kinvox
        </div>

        <div className="mt-6">
          {!resolved ? (
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">Link no longer valid</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  This SMS opt-in link isn&apos;t active — it may have already been used. If you still want text
                  updates, ask the team to resend the link or let them know by phone or email.
                </p>
              </div>
            </div>
          ) : resolved.alreadyOptedIn ? (
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">You&apos;re already opted in</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  You&apos;re already set to receive text updates from{' '}
                  <span className="text-gray-200 font-medium">{resolved.orgName}</span>. Reply{' '}
                  <span className="font-mono text-gray-300">STOP</span> to any message to stop.
                </p>
              </div>
            </div>
          ) : (
            <SmsOptInForm
              kind={resolved.kind}
              token={token}
              orgName={resolved.orgName}
              phoneDisplay={resolved.phoneE164 ? formatPhoneDisplay(resolved.phoneE164) : null}
            />
          )}
        </div>

        <p className="mt-8 text-center text-[10px] text-gray-600">
          Powered by Kinvox
        </p>
      </div>
    </main>
  )
}
