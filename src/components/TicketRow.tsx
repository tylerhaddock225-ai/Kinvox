'use client'

import { useRouter } from 'next/navigation'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

// One row-as-link component for every ticket list (HQ, HQ support, tenant).
// Navigates on row click OR Enter/Space, but skips the navigation when the
// event originates on an interactive child (link, button, select, input,
// label) so in-row controls — status/priority selects, copy-id buttons —
// handle their own clicks without hijacking.
export default function TicketRow({
  href,
  children,
}: {
  href:     string
  children: ReactNode
}) {
  const router = useRouter()

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return !!target.closest('a, button, select, input, label')
  }

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(e.target)) return
    router.push(href)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(e.target)) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      router.push(href)
    }
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="cursor-pointer transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
    >
      {children}
    </tr>
  )
}
