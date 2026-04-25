'use client'

import { useActionState, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { LeadQuestion } from '@/lib/lead-questions'
import { captureLeadAction, type CaptureLeadState } from './actions'

type Props = {
  slug:            string
  askHomestead:    boolean
  customQuestions: LeadQuestion[]
  /** Optional signal id from `?sig=` — server validates again. */
  signalId:        string | null
}

export default function LeadCaptureLandingForm({
  slug,
  askHomestead,
  customQuestions,
  signalId,
}: Props) {
  const [state, formAction, pending] = useActionState<CaptureLeadState, FormData>(
    captureLeadAction,
    null,
  )

  // Required custom answers are guarded by HTML5 `required` on the input,
  // but we mirror that with a client-side check so we can show a nicer
  // inline error rather than the browser tooltip.
  const [clientError, setClientError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    setClientError(null)
    const form = new FormData(e.currentTarget)
    for (const q of customQuestions) {
      if (!q.required) continue
      const v = String(form.get(`q_${q.id}`) ?? '').trim()
      if (!v) {
        e.preventDefault()
        setClientError(`Please answer: ${q.label}`)
        return
      }
    }
    // Otherwise let the form submit naturally so useActionState wires up.
  }

  if (state?.status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/30 p-6 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
        <h2 className="mt-3 text-lg font-semibold text-white">Thanks — you're on the list.</h2>
        <p className="mt-1 text-sm text-emerald-100/80">
          A team member will reach out within one business day.
        </p>
      </div>
    )
  }

  const errorMessage =
    clientError ?? (state?.status === 'error' ? state.error : null)

  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4">
      {/* Slug travels server-side via FormData; the action re-resolves it,
          so a tampered value can't write into someone else's tenant. */}
      <input type="hidden" name="slug" value={slug} readOnly />
      {signalId && (
        <input type="hidden" name="signal_id" value={signalId} readOnly />
      )}

      {/* Locked platform-mandatory fields — Name, Email, Phone, Address. */}
      <Field label="Name"            name="name"    required autoComplete="name" />
      <Field label="Email"           name="email"   type="email" required autoComplete="email" />
      <Field label="Phone"           name="phone"   type="tel"   required autoComplete="tel"   />
      <Field label="Service Address" name="address" required autoComplete="street-address" />
      <Field
        label="Preferred Appointment Date & Time"
        name="appointment_at"
        type="datetime-local"
        required
        min={minAppointmentValue()}
      />

      {askHomestead && (
        <label className="flex items-start gap-3 rounded-lg border border-pvx-border bg-pvx-surface/60 p-3 cursor-pointer">
          <input
            type="checkbox"
            name="homestead_exemption"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-pvx-border bg-pvx-bg text-emerald-500 focus:ring-emerald-500/40"
          />
          <span className="text-sm text-gray-100">
            I currently have an Oklahoma Homestead Exemption on this address.
            <span className="block mt-0.5 text-xs text-gray-400">
              Required to qualify for the Strengthen Oklahoma Homes grant.
            </span>
          </span>
        </label>
      )}

      {/* Tenant-defined questions, in saved order. */}
      {customQuestions.map((q) => (
        <Field
          key={q.id}
          label={q.label}
          name={`q_${q.id}`}
          required={q.required}
        />
      ))}

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        {pending && <Loader2 className="w-4 h-4 animate-spin" />}
        {pending ? 'Processing…' : 'Check my eligibility'}
      </button>

      <p className="text-[11px] text-center text-gray-500">
        We'll only use your info to contact you about this offer.
      </p>
    </form>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  autoComplete,
  min,
}: {
  label:         string
  name:          string
  type?:         string
  required?:     boolean
  autoComplete?: string
  min?:          string
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
        {label}{required && <span className="ml-1 text-rose-400">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        min={min}
        className="w-full rounded-lg bg-pvx-surface border border-pvx-border px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
      />
    </label>
  )
}

// Return today's date+time as a datetime-local value so the picker rejects
// past slots client-side. The server enforces it again — this is just UX.
function minAppointmentValue(): string {
  const d = new Date()
  // Strip seconds + millis and convert to local YYYY-MM-DDTHH:MM.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
