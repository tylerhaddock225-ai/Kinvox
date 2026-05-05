'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

type Order = 'asc' | 'desc'

export default function SortableHeader({
  label,
  sortKey,
  defaultOrder = 'desc',
  align = 'left',
}: {
  label:         string
  sortKey:       string
  defaultOrder?: Order
  align?:        'left' | 'right'
}) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const pathname     = usePathname()
  const [pending, startTransition] = useTransition()

  const activeSort  = searchParams.get('sort')
  const activeOrder = (searchParams.get('order') as Order | null) ?? null
  const isActive    = activeSort === sortKey

  function handleClick() {
    const next = new URLSearchParams(searchParams.toString())
    next.set('sort', sortKey)
    if (isActive) {
      // Toggle the existing column.
      next.set('order', activeOrder === 'asc' ? 'desc' : 'asc')
    } else {
      // First click on a fresh column uses its preferred default direction.
      next.set('order', defaultOrder)
    }
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    })
  }

  const Icon = isActive
    ? (activeOrder === 'asc' ? ChevronUp : ChevronDown)
    : ChevronsUpDown

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={`inline-flex items-center gap-1 font-medium transition-colors ${
        isActive ? 'text-gray-200' : 'text-gray-500 hover:text-gray-300'
      } ${align === 'right' ? 'ml-auto' : ''}`}
    >
      <span>{label}</span>
      <Icon className={`w-3 h-3 ${isActive ? 'opacity-100' : 'opacity-50'}`} />
    </button>
  )
}
