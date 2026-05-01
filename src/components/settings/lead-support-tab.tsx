'use client'

import { useEffect, useRef, useState, useTransition, useActionState } from 'react'
import {
  Radio,
  Wallet,
  Zap,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  X,
  RotateCcw,
  Sparkles,
  Send,
} from 'lucide-react'
import {
  setAiListeningEnabled,
  requestTopUp,
  cancelSubscription,
  reactivateSubscription,
  setEngagementMode,
} from '@/app/(app)/(dashboard)/actions/lead-support'
import {
  updateLeadEmail,
  refreshLeadEmailStatus,
  initializeLeadInboundEmail,
} from '@/app/(app)/(dashboard)/actions/org-settings'
import LeadQuestionManager from '@/components/settings/LeadQuestionManager'
import LeadMagnetFeaturesEditor from '@/components/settings/LeadMagnetFeaturesEditor'
import EmailVerificationPanel from '@/components/settings/EmailVerificationPanel'
import InboundAddressRow from '@/components/settings/InboundAddressRow'
import type { LeadQuestion } from '@/lib/lead-questions'

export type LeadSupportState = {
  ai_listening_enabled:                  boolean
  balance:                               number
  cancel_at_period_end:                  boolean
  current_period_end:                    string | null
  custom_lead_questions:                 LeadQuestion[]
  lead_magnet_features:                  string[]
  signal_engagement_mode:                'ai_draft' | 'manual'
  verified_lead_email:                   string | null
  verified_lead_email_confirmed_at:      string | null
  // Pre-constructed plus-addressed inbound email for the lead channel,
  // computed server-side from organizations.inbound_lead_email_tag.
  inbound_lead_email_address:            string | null
}

// Local tokens — kept inline so this file is self-contained. They match
// the tokens used in TeamTabs.tsx (the tenant settings design system).
const BTN            = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY    = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY  = `${BTN} text-gray-400 hover:text-white`
const BTN_DANGER     = `${BTN} bg-rose-600 text-white hover:bg-rose-500`
const BTN_DANGER_OUT = `${BTN} border border-rose-700/60 bg-rose-900/30 text-rose-100 hover:bg-rose-900/50`

const CREDIT_PACKAGES = [
  { credits: 50,   blurb: 'Starter'  },
  { credits: 200,  blurb: 'Standard' },
  { credits: 1000, blurb: 'Scale'    },
] as const

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-2xl">
      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
      <span>{message}</span>
    </div>
  )
}

// ── Top-Up Modal ─────────────────────────────────────────────────────────────

function TopUpModal({
  balance,
  onClose,
}: {
  balance: number
  onClose: (reason: 'dismissed' | 'submitted') => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, action, pending] = useActionState(requestTopUp, null)
  const [selected, setSelected] = useState<number>(CREDIT_PACKAGES[1].credits)

  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => { if (state?.status === 'success') onClose('submitted') }, [state, onClose])

  return (
    <dialog
      ref={dialogRef}
      onClose={() => onClose('dismissed')}
      className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold">Buy More Credits</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Current balance: <span className="text-gray-300 font-mono tabular-nums">{balance.toLocaleString()}</span> signals
          </p>
        </div>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form action={action} className="space-y-5">
        <input type="hidden" name="package_credits" value={selected} />

        <div className="grid grid-cols-3 gap-2">
          {CREDIT_PACKAGES.map((pkg) => {
            const active = pkg.credits === selected
            return (
              <button
                key={pkg.credits}
                type="button"
                onClick={() => setSelected(pkg.credits)}
                className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                  active
                    ? 'border-violet-500 bg-violet-500/15 text-white'
                    : 'border-pvx-border bg-black/25 text-gray-300 hover:border-gray-600'
                }`}
              >
                <div className="text-xs uppercase tracking-wider text-gray-400">{pkg.blurb}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  +{pkg.credits.toLocaleString()}
                </div>
                <div className="text-[11px] text-gray-500">signals</div>
              </button>
            )
          })}
        </div>

        {state?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}

        <p className="text-[11px] text-gray-500">
          Submits a request to our team. Checkout is not yet wired — until it is, a Kinvox admin will apply the grant manually.
        </p>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? 'Submitting…' : `Request ${selected.toLocaleString()} credits`}
          </button>
        </div>
      </form>
    </dialog>
  )
}

// ── Cancel Subscription Modal ────────────────────────────────────────────────

function CancelSubscriptionModal({
  currentPeriodEnd,
  onClose,
}: {
  currentPeriodEnd: string | null
  onClose: (reason: 'dismissed' | 'submitted') => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [state, action, pending] = useActionState(cancelSubscription, null)

  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => { if (state?.status === 'success') onClose('submitted') }, [state, onClose])

  const endCopy = currentPeriodEnd
    ? `on ${new Date(currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`
    : 'at the end of your current billing period'

  return (
    <dialog
      ref={dialogRef}
      onClose={() => onClose('dismissed')}
      className="m-auto w-full max-w-md rounded-xl border border-rose-900/60 bg-rose-950/20 p-6 text-white shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          <h2 className="text-base font-semibold text-rose-100">Cancel Subscription</h2>
        </div>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-3 text-sm text-rose-100/90">
        <p>
          Your Organization will remain <span className="font-semibold text-white">Active</span> until your subscription ends {endCopy}.
        </p>
        <p className="text-xs text-rose-200/70">
          After that, signal capture will stop and the AI agent will be paused.
          Team members keep read-only access to existing leads. You can
          reactivate at any time before the period ends.
        </p>
      </div>

      <form action={action} className="mt-5 space-y-4">
        {state?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
            Keep subscription
          </button>
          <button type="submit" disabled={pending} className={BTN_DANGER}>
            {pending ? 'Cancelling…' : 'Yes, cancel at period end'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

// ── Reply Strategy selector ──────────────────────────────────────────────────

function ReplyStrategySelector({ current }: { current: 'ai_draft' | 'manual' }) {
  const [state, action, pending] = useActionState(setEngagementMode, null)
  const [selected, setSelected]  = useState<'ai_draft' | 'manual'>(current)
  const formRef = useRef<HTMLFormElement>(null)
  const [, startTransition] = useTransition()

  function choose(mode: 'ai_draft' | 'manual') {
    if (mode === selected) return
    setSelected(mode)
    startTransition(() => formRef.current?.requestSubmit())
  }

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-300">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Reply Strategy</h3>
          <p className="text-xs text-gray-500 mt-1">
            Controls what happens after the AI captures a signal. Change any time — only affects signals captured going forward.
          </p>
        </div>
      </div>

      <form ref={formRef} action={action}>
        <input type="hidden" name="mode" value={selected} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StrategyCard
            active={selected === 'ai_draft'}
            title="AI-Draft Mode"
            blurb="Signals go to the Review Queue with an AI-generated reply. You approve before anything is sent."
            icon={<Send className="w-4 h-4" />}
            onClick={() => choose('ai_draft')}
            disabled={pending}
          />
          <StrategyCard
            active={selected === 'manual'}
            title="Manual Mode"
            blurb="Signals go straight to Leads. No auto-reply — your team decides how to respond."
            icon={<Radio className="w-4 h-4" />}
            onClick={() => choose('manual')}
            disabled={pending}
          />
        </div>
      </form>

      {state?.status === 'error' && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
    </div>
  )
}

function StrategyCard({
  active,
  title,
  blurb,
  icon,
  onClick,
  disabled,
}: {
  active:   boolean
  title:    string
  blurb:    string
  icon:     React.ReactNode
  onClick:  () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-left rounded-lg border px-4 py-3 transition-colors disabled:opacity-60 ${
        active
          ? 'border-violet-500 bg-violet-500/15'
          : 'border-pvx-border bg-black/25 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-violet-200' : 'text-gray-400'}>{icon}</span>
        <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>
          {title}
        </span>
        {active && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-200">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Active
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-gray-500 leading-relaxed">
        {blurb}
      </p>
    </button>
  )
}

// ── Lead Support panel ───────────────────────────────────────────────────────

export default function LeadSupportTab({ state: initialState }: { state: LeadSupportState }) {
  const [toggleState, toggleAction, togglePending] = useActionState(setAiListeningEnabled, null)
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(reactivateSubscription, null)

  const [enabled,   setEnabled]   = useState<boolean>(initialState.ai_listening_enabled)
  const [showTopUp, setShowTopUp] = useState(false)
  const [showCancel,setShowCancel]= useState(false)
  const [toast,     setToast]     = useState<string | null>(null)

  const toggleFormRef = useRef<HTMLFormElement>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (toggleState?.status === 'success' && toggleState.message) setToast(toggleState.message)
  }, [toggleState])
  useEffect(() => {
    if (reactivateState?.status === 'success' && reactivateState.message) setToast(reactivateState.message)
  }, [reactivateState])

  function handleToggle(next: boolean) {
    setEnabled(next)
    startTransition(() => toggleFormRef.current?.requestSubmit())
  }

  const periodEndCopy = initialState.current_period_end
    ? new Date(initialState.current_period_end).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null

  return (
    <div className="space-y-6">
      {/* Lead notifications email — channel parallel to Support Settings'
          customer-facing email, but scoped to lead-magnet flows. */}
      <EmailVerificationPanel
        title="Lead notifications email"
        description="Used as the From address on lead-magnet confirmations and the recipient for new lead alerts."
        inputName="lead_email"
        inputId="lead-email"
        email={initialState.verified_lead_email}
        confirmedAt={initialState.verified_lead_email_confirmed_at}
        verifyAction={updateLeadEmail}
        refreshAction={refreshLeadEmailStatus}
        onSuccessToast={setToast}
      />

      {/* Lead-channel inbound forwarding address — parallel to the
          Support Settings tab's Kinvox Forwarding Address. Replies threaded
          via the [ld_<display_id>] tag will land here once Prompt 2 wires
          Reply-To onto outbound and Prompt 3 routes via MailboxHash. */}
      <InboundAddressRow
        address={initialState.inbound_lead_email_address}
        action={initializeLeadInboundEmail}
        tagPrefix="ld"
        heading="Your lead inbound forwarding address"
      />

      {/* Social Listening Status */}
      <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-300">
              <Radio className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Social Listening Status</h3>
              <p className="text-xs text-gray-500 mt-1">
                When enabled, the AI agent scans public posts and creates leads for your Organization. Pausing stops all signal capture — no credits are consumed while paused.
              </p>
            </div>
          </div>

          <form ref={toggleFormRef} action={toggleAction} className="shrink-0">
            <input type="hidden" name="enabled" value={enabled ? 'on' : ''} />
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                disabled={togglePending}
                onChange={(e) => handleToggle(e.target.checked)}
                className="peer sr-only"
              />
              <div className="w-11 h-6 rounded-full bg-gray-700 border border-pvx-border peer-checked:bg-violet-600 peer-checked:border-violet-500 transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-gray-300 peer-checked:bg-white peer-checked:translate-x-5 transition-transform" />
            </label>
          </form>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">Status:</span>
          {enabled ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
              <CheckCircle2 className="w-3 h-3" />
              Active — capturing signals
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
              <Clock className="w-3 h-3" />
              Paused
            </span>
          )}
        </div>

        {toggleState?.status === 'error' && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {toggleState.error}
          </p>
        )}
      </div>

      {/* Reply Strategy */}
      <ReplyStrategySelector current={initialState.signal_engagement_mode} />

      {/* Credit Balance (read-only) */}
      <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-semibold text-white">Credit Balance</h3>
        </div>

        <div className="flex items-end justify-between gap-4 rounded-lg border border-pvx-border bg-black/25 p-4">
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">Available</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold text-white tabular-nums">
                {initialState.balance.toLocaleString()}
              </span>
              <span className="text-xs text-gray-500">signals</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Signals are charged 1/3/6 credits based on AI-assessed intent tier.
            </p>
          </div>

          <button type="button" onClick={() => setShowTopUp(true)} className={`${BTN_PRIMARY} shrink-0`}>
            <Zap className="w-4 h-4" />
            Buy More Credits
          </button>
        </div>

        {initialState.balance <= 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Balance is empty. Signal capture will return a top-up prompt until credits are added.</span>
          </div>
        )}
      </div>

      {/* Page Features (org-side editor; HQ retains slug/enabled/headline/website) */}
      <LeadMagnetFeaturesEditor initial={initialState.lead_magnet_features} />

      {/* Lead Questionnaire */}
      <LeadQuestionManager initial={initialState.custom_lead_questions} />

      {/* Subscription Management (Danger Zone) */}
      <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <h3 className="text-sm font-semibold text-rose-200">Subscription Management</h3>
        </div>

        {initialState.cancel_at_period_end ? (
          <>
            <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Your subscription is scheduled to cancel
                {periodEndCopy ? <> on <span className="font-semibold">{periodEndCopy}</span></> : ' at the end of the current billing period'}.
                Your Organization remains Active until then.
              </span>
            </div>

            <form action={reactivateAction}>
              <button type="submit" disabled={reactivatePending} className={`${BTN_PRIMARY}`}>
                <RotateCcw className="w-4 h-4" />
                {reactivatePending ? 'Reactivating…' : 'Reactivate subscription'}
              </button>
              {reactivateState?.status === 'error' && (
                <p className="mt-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                  {reactivateState.error}
                </p>
              )}
            </form>
          </>
        ) : (
          <>
            <p className="text-xs text-rose-300/80">
              Cancelling pauses AI signal capture at the end of your current billing period. Your Organization and all existing leads are preserved.
            </p>
            <button type="button" onClick={() => setShowCancel(true)} className={BTN_DANGER_OUT}>
              <ShieldAlert className="w-4 h-4" />
              Cancel Subscription
            </button>
          </>
        )}
      </div>

      {showTopUp && (
        <TopUpModal
          balance={initialState.balance}
          onClose={(reason) => {
            setShowTopUp(false)
            if (reason === 'submitted') setToast('Top-up request submitted — our team will follow up.')
          }}
        />
      )}

      {showCancel && (
        <CancelSubscriptionModal
          currentPeriodEnd={initialState.current_period_end}
          onClose={(reason) => {
            setShowCancel(false)
            if (reason === 'submitted') setToast('Subscription will cancel at period end.')
          }}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
