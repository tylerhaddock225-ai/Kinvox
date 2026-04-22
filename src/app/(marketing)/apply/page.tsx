'use client'

import { useActionState } from 'react'
import { submitApplication, type ApplyState } from './actions'

export default function ApplyPage() {
  const [state, formAction, pending] = useActionState<ApplyState, FormData>(
    submitApplication,
    null
  )

  return (
    <section className="max-w-xl mx-auto px-6 py-20">
      <h1 className="text-4xl font-semibold tracking-tight">Apply for access</h1>
      <p className="mt-3 text-gray-400">
        Kinvox is invite-only while we onboard our first wave of Oklahoma City customers.
        Tell us about your business and we&rsquo;ll reach out.
      </p>

      {state?.ok ? (
        <div className="mt-8 rounded-lg border border-emerald-700 bg-emerald-900/30 px-4 py-3 text-emerald-200">
          {state.message}
        </div>
      ) : (
        <form action={formAction} className="mt-8 space-y-5">
          <Field label="Business name" name="business_name" required maxLength={200} />
          <Field label="Email" name="email" type="email" required maxLength={254} />
          <Field
            label="Website"
            name="website"
            required
            placeholder="https://example.com"
          />

          {state && !state.ok && (
            <p className="text-sm text-red-400">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-white text-gray-900 hover:bg-gray-200 disabled:opacity-60 px-5 py-2.5 font-medium"
          >
            {pending ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      )}
    </section>
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  maxLength,
  placeholder,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  maxLength?: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-300 mb-1.5">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full rounded-lg bg-gray-900 border border-gray-700 focus:border-gray-500 focus:outline-none px-3 py-2 text-gray-100"
      />
    </label>
  )
}
