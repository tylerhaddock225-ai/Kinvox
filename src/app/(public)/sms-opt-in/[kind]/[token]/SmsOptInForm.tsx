'use client'

import { useActionState } from 'react'
import { MessageSquare, CheckCircle2, AlertTriangle } from 'lucide-react'
import { confirmOptInAction, type OptInFormState } from './actions'

const ERROR_COPY: Record<string, string> = {
  link_invalid:  'This link is no longer valid. It may have already been used.',
  phone_required: 'Enter a valid mobile number so we know where to text you.',
  rate_limited:  'Too many attempts — please wait a moment and try again.',
  store_failed:  'Something went wrong saving your preference. Please try again.',
  bad_request:   'This link looks malformed. Please use the link from your email.',
}

const INITIAL = null as OptInFormState

// Confirm form for the public SMS opt-in page. When a number is on file we show
// a one-tap confirm; otherwise a phone input is required. Success state is
// forward-true about STOP handling (that arrives in a later stage).
export default function SmsOptInForm({
  kind,
  token,
  orgName,
  phoneDisplay,
}: {
  kind:  'customer' | 'lead'
  token: string
  orgName: string
  // Pretty phone on file, or null when none is parseable (→ ask for one).
  phoneDisplay: string | null
}) {
  const [state, action, pending] = useActionState(confirmOptInAction, INITIAL)

  if (state?.status === 'success') {
    return (
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <h1 className="text-lg font-semibold text-white">You&apos;re set</h1>
          <p className="mt-1 text-sm text-gray-400 leading-relaxed">
            We&apos;ll text updates to <span className="text-gray-200 font-medium">{state.phoneDisplay}</span>.
            Reply <span className="font-mono text-gray-300">STOP</span> anytime to stop.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="token" value={token} />

      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <h1 className="text-lg font-semibold text-white">Get text updates from {orgName}</h1>
          <p className="mt-1 text-sm text-gray-400 leading-relaxed">
            {phoneDisplay
              ? <>We&apos;ll send updates by SMS to <span className="text-gray-200 font-medium">{phoneDisplay}</span>. Message &amp; data rates may apply; reply STOP anytime.</>
              : <>Enter your mobile number and we&apos;ll send updates by SMS. Message &amp; data rates may apply; reply STOP anytime.</>}
          </p>
        </div>
      </div>

      {!phoneDisplay && (
        <div>
          <label htmlFor="opt_phone" className="block text-xs font-medium text-gray-400 mb-1">
            Mobile number
          </label>
          <input
            id="opt_phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="(555) 123-4567"
            className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
      )}

      {state?.status === 'error' && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[13px] text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{ERROR_COPY[state.error] ?? 'Something went wrong. Please try again.'}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex items-center justify-center rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending
          ? 'Saving…'
          : phoneDisplay
            ? `Yes, text me at ${phoneDisplay}`
            : 'Yes, text me'}
      </button>
    </form>
  )
}
