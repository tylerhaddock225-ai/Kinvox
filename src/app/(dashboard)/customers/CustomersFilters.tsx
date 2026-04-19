'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'

// Mirrors LeadsFilters styling + debounce exactly so the two search bars
// feel identical. No status/source selects — customers don\u2019t carry those.
export default function CustomersFilters() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [, startTrans] = useTransition()

  const [q, setQ] = useState(searchParams.get('q') ?? '')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function push(next: URLSearchParams) {
    const qs = next.toString()
    startTrans(() => {
      router.replace(qs ? `/customers?${qs}` : '/customers')
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
          placeholder="Search name, company, email\u2026"
          className="w-full rounded-lg border border-pvx-border bg-pvx-surface pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      {q && (
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
