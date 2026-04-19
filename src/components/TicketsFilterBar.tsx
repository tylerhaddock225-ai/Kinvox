'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { X } from 'lucide-react'

type Member = { id: string; full_name: string | null }

const SELECT_CLASS =
  'rounded-lg border border-pvx-border bg-pvx-surface px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500'

export default function TicketsFilterBar({ members }: { members: Member[] }) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const status   = searchParams.get('status')   ?? ''
  const priority = searchParams.get('priority') ?? ''
  const assigned = searchParams.get('assigned') ?? ''

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else       next.delete(key)
    startTransition(() => {
      router.replace(`/tickets${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false })
    })
  }

  const hasAny = !!(status || priority || assigned)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-gray-500 mr-1">Filter</span>

      <select
        value={status}
        onChange={e => update('status', e.target.value)}
        className={SELECT_CLASS}
        disabled={pending}
      >
        <option value="">All statuses</option>
        <option value="open">Open</option>
        <option value="pending">Pending</option>
        <option value="closed">Closed</option>
      </select>

      <select
        value={priority}
        onChange={e => update('priority', e.target.value)}
        className={SELECT_CLASS}
        disabled={pending}
      >
        <option value="">All priorities</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <select
        value={assigned}
        onChange={e => update('assigned', e.target.value)}
        className={SELECT_CLASS}
        disabled={pending}
      >
        <option value="">All assignees</option>
        <option value="unassigned">Unassigned</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.full_name ?? 'Unknown'}</option>
        ))}
      </select>

      {hasAny && (
        <button
          type="button"
          onClick={() => startTransition(() => router.replace('/tickets', { scroll: false }))}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          disabled={pending}
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </div>
  )
}
