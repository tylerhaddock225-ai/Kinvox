'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import type { LeadQuestion, LeadAnswer } from '@/lib/lead-questions'

type Props = {
  slug:            string
  askHomestead:    boolean
  customQuestions: LeadQuestion[]
}

export default function LeadCaptureLandingForm({
  slug,
  askHomestead,
  customQuestions,
}: Props) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError]   = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setError(null)

    const form = new FormData(e.currentTarget)

    // Collect custom answers. Required answers are enforced by the
    // `required` attribute on the inputs too; this is a belt check.
    const customAnswers: LeadAnswer[] = []
    for (const q of customQuestions) {
      const raw = String(form.get(`q_${q.id}`) ?? '').trim()
      if (!raw) {
        if (q.required) {
          setError(`Please answer: ${q.label}`)
          setStatus('error')
          return
        }
        continue
      }
      customAnswers.push({ question_id: q.id, label: q.label, answer: raw })
    }

    const payload = {
      slug,
      name:  String(form.get('name')  ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim(),
      address: String(form.get('address') ?? '').trim(),
      homestead_exemption: askHomestead
        ? form.get('homestead_exemption') === 'on'
        : null,
      custom_answers: customAnswers,
    }

    try {
      const res = await fetch('/api/v1/leads/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'submission failed' }))
        setError(body.error ?? 'Submission failed — please try again.')
        setStatus('error')
        return
      }
      setStatus('success')
    } catch {
      setError('Network error — please try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Locked platform-mandatory fields — Name, Email, Phone. */}
      <Field label="Name"  name="name"  required autoComplete="name" />
      <Field label="Email" name="email" type="email" required autoComplete="email" />
      <Field label="Phone" name="phone" type="tel"   required autoComplete="tel"   />
      <Field label="Address" name="address" autoComplete="street-address" />

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

      {/* Tenant-defined questions. Rendered in the order saved under
          organizations.custom_lead_questions. */}
      {customQuestions.map((q) => (
        <Field
          key={q.id}
          label={q.label}
          name={`q_${q.id}`}
          required={q.required}
        />
      ))}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        {status === 'submitting' && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === 'submitting' ? 'Submitting…' : 'Check my eligibility'}
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
}: {
  label:         string
  name:          string
  type?:         string
  required?:     boolean
  autoComplete?: string
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
        className="w-full rounded-lg bg-pvx-surface border border-pvx-border px-3 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
      />
    </label>
  )
}
