'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import {
  CheckCircle2,
  Clock,
  ShieldAlert,
  X,
  RotateCcw,
  ExternalLink,
} from 'lucide-react'
import {
  cancelSubscription,
  reactivateSubscription,
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
import { CopyButton } from '@/components/ui/copy-button'
import type { LeadQuestion } from '@/lib/lead-questions'

export type LeadSupportState = {
  cancel_at_period_end:                  boolean
  current_period_end:                    string | null
  custom_lead_questions:                 LeadQuestion[]
  lead_magnet_features:                  string[]
  verified_lead_email:                   string | null
  verified_lead_email_confirmed_at:      string | null
  // Pre-constructed plus-addressed inbound email for the lead channel,
  // computed server-side from organizations.inbound_lead_email_tag.
  inbound_lead_email_address:            string | null
  // Slug under organizations.lead_magnet_slug — rendered as a public URL
  // (`${landingBase}/l/${lead_magnet_slug}`) above the inbound email row.
  // Null hides the URL row entirely; no placeholder, no config affordance
  // (HQ owns slug configuration).
  lead_magnet_slug:                      string | null
  landing_base:                          string
}

// Local tokens — kept inline so this file is self-contained. They match
// the tokens used in TeamTabs.tsx (the tenant settings design system).
const BTN            = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY    = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY  = `${BTN} text-gray-400 hover:text-white`
const BTN_DANGER     = `${BTN} bg-rose-600 text-white hover:bg-rose-500`
const BTN_DANGER_OUT = `${BTN} border border-rose-700/60 bg-rose-900/30 text-rose-100 hover:bg-rose-900/50`

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

// ── Lead Support panel ───────────────────────────────────────────────────────

export default function LeadSupportTab({ state: initialState }: { state: LeadSupportState }) {
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(reactivateSubscription, null)

  const [showCancel, setShowCancel] = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)

  useEffect(() => {
    if (reactivateState?.status === 'success' && reactivateState.message) setToast(reactivateState.message)
  }, [reactivateState])

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

      {/* Public lead magnet URL — read-only. HQ owns slug configuration;
          this row only renders when a slug is set, and renders nothing
          when it's null (no empty-state, no config affordance). */}
      {initialState.lead_magnet_slug && (
        <section className="rounded-lg border border-pvx-border bg-pvx-surface/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Your lead magnet URL
          </h3>
          <div className="mt-2 flex items-center gap-2">
            <a
              href={`${initialState.landing_base}/l/${initialState.lead_magnet_slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-violet-300 hover:text-violet-200"
            >
              {`${initialState.landing_base}/l/${initialState.lead_magnet_slug}`}
              <ExternalLink className="w-3 h-3" />
            </a>
            <CopyButton
              text={`${initialState.landing_base}/l/${initialState.lead_magnet_slug}`}
              label="Copy link"
            />
          </div>
        </section>
      )}

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
