'use client'

import { useState } from 'react'

export function BuyCreditsButton({
  bundle,
  label,
}: {
  bundle: string
  label:  string
}) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function onClick() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ bundle }),
      })
      const payload = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !payload.url) {
        setError(payload.error ?? 'Checkout failed')
        setLoading(false)
        return
      }
      window.location.href = payload.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? 'Redirecting…' : label}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  )
}
