'use client'

import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
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

// ── Lead Support panel ───────────────────────────────────────────────────────

export default function LeadSupportTab({ state: initialState }: { state: LeadSupportState }) {
  const [toast, setToast] = useState<string | null>(null)

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

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
