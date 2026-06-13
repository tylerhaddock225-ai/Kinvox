'use client'

import { useState, type FormEvent } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const INPUT =
  'w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent'

export default function InviteAcceptForm({
  token,
  email,
  defaultFullName,
  orgName,
  roleName,
}: {
  token:           string
  email:           string
  defaultFullName: string | null
  orgName:         string
  roleName:        string | null
}) {
  const [fullName, setFullName]     = useState(defaultFullName ?? '')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const name = fullName.trim()
    if (!name)               { setError('Please enter your full name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setSubmitting(true)

    let res: Response
    try {
      res = await fetch('/api/auth/accept-invite', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password, full_name: name }),
      })
    } catch {
      setError('Network error. Please try again.')
      setSubmitting(false)
      return
    }

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error || 'Could not accept invitation')
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    setFinalizing(true)

    // Auto sign-in via the cookie-aware browser client (mirrors
    // PendingInviteGate) so the middleware sorting hat sees the new session
    // and routes us to /${orgSlug}. The localStorage singleton in
    // lib/supabase/client.ts is invisible to the server middleware.
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      // The account exists and the invite is redeemed — fall back to manual
      // sign-in rather than stranding the user.
      window.location.href = '/login'
      return
    }
    window.location.href = '/'
  }

  return (
    <div className="mt-6 w-full max-w-sm">
      <h1 className="text-xl font-semibold text-white">Join {orgName}</h1>
      <p className="mt-1 text-sm text-gray-400">Role: {roleName ?? 'Member'}</p>

      <div className="mt-5 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm">
        <span className="text-gray-500 text-xs">Invited email</span>
        <span className="block text-gray-200 font-mono">{email}</span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Full name</label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            type="text"
            required
            placeholder="Jane Smith"
            className={INPUT}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
          <input
            value={password}
            onChange={e => setPassword(e.target.value)}
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
            className={INPUT}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm password</label>
          <input
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            type="password"
            required
            placeholder="••••••••"
            className={INPUT}
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || finalizing}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
        >
          {finalizing
            ? `You're in — taking you to ${orgName}…`
            : submitting
              ? 'Joining…'
              : `Join ${orgName}`}
        </button>
      </form>
    </div>
  )
}
