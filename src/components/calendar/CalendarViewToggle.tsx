'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { User, Users, Globe } from 'lucide-react'

type Member = { id: string; full_name: string | null }
type View   = 'mine' | 'agent' | 'global'

export default function CalendarViewToggle({
  members,
  canSeeGlobal,
}: {
  members:      Member[]
  canSeeGlobal: boolean
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const view: View = (() => {
    const v = searchParams.get('view')
    if (v === 'global' && canSeeGlobal) return 'global'
    if (v === 'agent') return 'agent'
    return 'mine'
  })()

  const agentId = searchParams.get('agent') ?? ''

  function setView(next: View, agent?: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'mine') {
      params.delete('view')
      params.delete('agent')
    } else if (next === 'global') {
      params.set('view', 'global')
      params.delete('agent')
    } else {
      params.set('view', 'agent')
      if (agent) params.set('agent', agent)
      else       params.delete('agent')
    }
    const qs = params.toString()
    startTransition(() => router.replace(`/appointments${qs ? `?${qs}` : ''}`, { scroll: false }))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-pvx-border bg-pvx-surface p-0.5">
        <button
          type="button"
          onClick={() => setView('mine')}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'mine' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          Mine
        </button>
        <button
          type="button"
          onClick={() => setView('agent', agentId)}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            view === 'agent' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          By agent
        </button>
        {canSeeGlobal && (
          <button
            type="button"
            onClick={() => setView('global')}
            disabled={pending}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'global' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Global
          </button>
        )}
      </div>

      {view === 'agent' && (
        <select
          value={agentId}
          onChange={e => setView('agent', e.target.value)}
          disabled={pending}
          className="rounded-lg border border-pvx-border bg-pvx-surface px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">— Pick an agent —</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>{m.full_name ?? 'Unknown'}</option>
          ))}
        </select>
      )}
    </div>
  )
}
