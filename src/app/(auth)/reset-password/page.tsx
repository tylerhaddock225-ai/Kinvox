'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

export default function ResetPasswordPage() {
  // useSearchParams() must live under a Suspense boundary or `next build`
  // bails out with "missing-suspense-with-csr-bailout" on this route.
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordFallback() {
  return (
    <div className="w-full max-w-sm text-center text-sm text-gray-500">Loading…</div>
  )
}

function ResetPasswordForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const token        = searchParams.get('token') ?? ''

  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  async function handleSubmit(formData: FormData) {
    setLoading(true)
    setError(null)

    const password = formData.get('password') as string
    const confirm  = formData.get('confirm_password') as string
    if (password !== confirm) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'Could not reset password.')
        setLoading(false)
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 1800)
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="w-full max-w-sm text-center space-y-3">
        <h1 className="text-2xl font-bold text-white">Invalid reset link</h1>
        <p className="text-sm text-gray-400">
          This URL is missing a token. Request a new email from the forgot-password page.
        </p>
        <Link href="/forgot-password" className="inline-block mt-2 text-sm text-emerald-400 hover:text-emerald-300 font-medium">
          Request a new link
        </Link>
      </div>
    )
  }

  if (done) {
    return (
      <div className="w-full max-w-sm text-center space-y-3">
        <h1 className="text-2xl font-bold text-white">Password updated</h1>
        <p className="text-sm text-gray-400">Redirecting you to sign in…</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-white">Set a new password</h1>
        <p className="text-sm text-gray-400 mt-1">Choose something memorable but strong.</p>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">New password</label>
          <input
            name="password"
            type="password"
            required
            autoFocus
            placeholder="••••••••"
            className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm password</label>
          <input
            name="confirm_password"
            type="password"
            required
            placeholder="••••••••"
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
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 mt-6">
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300 font-medium">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
