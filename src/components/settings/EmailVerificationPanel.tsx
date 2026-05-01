'use client'

// Reusable Postmark sender-signature verification panel.
//
// Used twice today: once in Support Settings (verified_support_email,
// gates support-ticket replies) and once in Lead Support (verified_lead_email,
// gates lead-magnet confirmations + new-lead alerts). Both bind to the
// same Postmark Account API plumbing — same Verify Email button, same
// Pending/Verified badge, same Refresh status button, same inline notice
// shape — so the panel is parameterised to keep the two surfaces visually
// and behaviorally identical.
//
// Server actions are passed in by the caller. The verify action follows
// the useActionState reducer shape `(prev, formData) => Promise<State>`;
// the refresh action is a parameterless `() => Promise<RefreshResult>`
// driven by useTransition.

import { useActionState, useEffect, useState, useTransition } from 'react'
import { CheckCircle2, Clock, Mail, RotateCcw, AlertCircle } from 'lucide-react'

const INPUT          = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
const LABEL          = 'block text-xs font-medium text-gray-400 mb-1'
const BTN            = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY    = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY  = `${BTN} text-gray-400 hover:text-white`

type VerifyState =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

export type RefreshResult =
  | { status: 'success';   message: string }
  | { status: 'pending';   message: string }
  | { status: 'not_found'; message: string }
  | { status: 'error';     error: string }

type Props = {
  title:         string
  description:   string
  inputName:     string                 // form field name the verify action reads
  inputId:       string                 // <label htmlFor> + <input id>
  email:         string | null
  confirmedAt:   string | null
  verifyAction:  (prev: VerifyState, formData: FormData) => Promise<VerifyState>
  refreshAction: () => Promise<RefreshResult>
  onSuccessToast?: (message: string) => void  // optional: surface success to a parent toast
}

export default function EmailVerificationPanel({
  title,
  description,
  inputName,
  inputId,
  email,
  confirmedAt,
  verifyAction,
  refreshAction,
  onSuccessToast,
}: Props) {
  const [state, action, pending] = useActionState(verifyAction, null)
  const [refreshPending, startRefresh] = useTransition()
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)

  // Bubble verify successes up to the parent for toast rendering.
  useEffect(() => {
    if (state?.status === 'success' && state.message && onSuccessToast) {
      onSuccessToast(state.message)
    }
  }, [state, onSuccessToast])

  // Saving a new email resets any prior refresh notice — the Postmark
  // state we last reconciled against may no longer apply.
  useEffect(() => {
    if (state?.status === 'success') setRefreshResult(null)
  }, [state])

  const isConfirmed = !!confirmedAt
  const hasEmail    = !!email

  function handleRefresh() {
    startRefresh(async () => {
      const result = await refreshAction()
      setRefreshResult(result)
      if (result.status === 'success' && onSuccessToast) onSuccessToast(result.message)
    })
  }

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className={LABEL} htmlFor={inputId}>Email Address</label>
          <div className="flex gap-2">
            <input
              id={inputId}
              name={inputName}
              type="email"
              required
              defaultValue={email ?? ''}
              placeholder="you@yourcompany.com"
              className={INPUT}
            />
            <button type="submit" disabled={pending} className={BTN_PRIMARY + ' shrink-0'}>
              <Mail className="w-4 h-4" />
              {pending ? 'Sending…' : 'Verify Email'}
            </button>
          </div>

          {hasEmail && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Status:</span>
                {isConfirmed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                    <CheckCircle2 className="w-3 h-3" />
                    Verified
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
                      <Clock className="w-3 h-3" />
                      Pending Verification
                    </span>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={refreshPending}
                      className={BTN_SECONDARY + ' !px-2 !py-1 text-[11px]'}
                    >
                      <RotateCcw className={`w-3 h-3 ${refreshPending ? 'animate-spin' : ''}`} />
                      {refreshPending ? 'Checking…' : 'Refresh status'}
                    </button>
                  </>
                )}
              </div>

              {refreshResult && (
                <p
                  className={
                    'flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ' +
                    (refreshResult.status === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : refreshResult.status === 'pending'
                      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
                      : refreshResult.status === 'not_found'
                      ? 'border-orange-500/30 bg-orange-500/10 text-orange-200'
                      : 'border-red-400/30 bg-red-400/10 text-red-300')
                  }
                >
                  {refreshResult.status === 'success' ? (
                    <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
                  ) : refreshResult.status === 'pending' ? (
                    <Clock className="w-3 h-3 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {refreshResult.status === 'error' ? refreshResult.error : refreshResult.message}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        {state?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}
      </form>
    </div>
  )
}
