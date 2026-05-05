'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useOrgSlug } from '@/lib/hooks/useOrgSlug'

export default function LeadsFilters() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const orgSlug      = useOrgSlug()
  const [, startTrans] = useTransition()

  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const status    = searchParams.get('status') ?? ''
  const source    = searchParams.get('source') ?? ''

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function push(next: URLSearchParams) {
    const qs = next.toString()
    const base = orgSlug ? `/${orgSlug}/leads` : '/leads'
    startTrans(() => {
      router.replace(qs ? `${base}?${qs}` : base)
    })
  }

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else       next.delete(key)
    push(next)
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const current = searchParams.get('q') ?? ''
      if (q === current) return
      updateParam('q', q)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const hasFilters = Boolean(q || status || source)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, company, email…"
          className="w-full rounded-lg border border-pvx-border bg-pvx-surface pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <select
        value={status}
        onChange={e => updateParam('status', e.target.value)}
        className="rounded-lg border border-pvx-border bg-pvx-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
      >
        <option value="">All statuses</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="converted">Converted</option>
        <option value="lost">Lost</option>
      </select>

      <select
        value={source}
        onChange={e => updateParam('source', e.target.value)}
        className="rounded-lg border border-pvx-border bg-pvx-surface px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
      >
        <option value="">All sources</option>
        <option value="web">Web</option>
        <option value="referral">Referral</option>
        <option value="import">Import</option>
        <option value="manual">Manual</option>
        <option value="other">Other</option>
      </select>

      {hasFilters && (
        <button
          type="button"
          onClick={() => { setQ(''); push(new URLSearchParams()) }}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  )
}
