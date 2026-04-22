'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'

// Mirrors LeadsFilters/CustomersFilters styling exactly. Preserves the
// existing ?show=all param that controls archived visibility.
export default function OrgFilters() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [, startTrans] = useTransition()

  const [q, setQ] = useState(searchParams.get('q') ?? '')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function push(next: URLSearchParams) {
    const qs = next.toString()
    startTrans(() => {
      router.replace(qs ? `/admin-hq/organizations?${qs}` : '/admin-hq/organizations')
    })
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const current = searchParams.get('q') ?? ''
      if (q === current) return
      const next = new URLSearchParams(searchParams.toString())
      if (q) next.set('q', q)
      else   next.delete('q')
      push(next)
    }, 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search organization name, vertical\u2026"
          className="w-full rounded-lg border border-pvx-border bg-pvx-surface pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      {q && (
        <button
          type="button"
          onClick={() => {
            setQ('')
            // Preserve ?show=all when clearing the search.
            const next = new URLSearchParams(searchParams.toString())
            next.delete('q')
            push(next)
          }}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  )
}
