'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.get('email') }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white">Reset your password</h1>
        <p className="text-sm text-gray-400 mt-1">
          We&rsquo;ll email you a link to set a new one.
        </p>
      </div>

      {submitted ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-200 text-center space-y-1">
          <p className="font-medium">Check your inbox.</p>
          <p className="text-emerald-200/80 text-xs">
            If an account exists for that address, a reset link is on its way.
          </p>
        </div>
      ) : (
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-gray-500 mt-6">
        Remembered it?{' '}
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
