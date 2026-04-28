'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { adminGlobalSearch } from '@/app/(app)/(admin)/hq/actions/search'

export default function AdminGlobalSearch() {
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTrans] = useTransition()
  const router = useRouter()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = q.trim()
    if (!query) return

    setError(null)
    startTrans(async () => {
      const hit = await adminGlobalSearch(query)
      if (!hit) {
        setError('No match found.')
        return
      }
      if (hit.type === 'organization') {
        router.push(`/hq/organizations/${hit.id}`)
      } else {
        router.push(`/hq/tickets/${hit.id}`)
      }
      setQ('')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-md">
      <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        type="text"
        value={q}
        onChange={e => { setQ(e.target.value); if (error) setError(null) }}
        placeholder="Search by ID \u2014 org_123, tk_123\u2026"
        disabled={pending}
        className="w-full rounded-lg border border-pvx-border bg-pvx-surface pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-60"
      />
      {error && (
        <p className="absolute left-0 right-0 top-full mt-1 text-xs text-red-400 px-1">
          {error}
        </p>
      )}
    </form>
  )
}
