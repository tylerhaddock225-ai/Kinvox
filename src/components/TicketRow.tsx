'use client'

import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'

// One row-as-link component for every ticket list (HQ, HQ support, tenant).
// Navigates on row click OR Enter/Space, but skips the navigation when the
// event originates on an interactive child (link, button, select, input,
// label) so in-row controls — status/priority selects, copy-id buttons —
// handle their own clicks without hijacking.
//
// AD Stage 3 (tenant grid only): when `unseen`/`draftReady` are supplied, a
// leading marker gutter renders the leads-style unseen dot + a violet
// "AI draft ready" Sparkles. The gutter cell is rendered iff a marker prop is
// present, so callers that don't opt in (HQ tickets, HQ support, customer
// detail) keep their existing column count. The tenant grid adds a matching
// leading <th>.
export default function TicketRow({
  href,
  children,
  unseen,
  draftReady,
}: {
  href:        string
  children:    ReactNode
  unseen?:     boolean
  draftReady?: boolean
}) {
  const router = useRouter()

  // Opt-in gutter: the tenant grid passes a boolean for every row, so all its
  // rows render the cell and stay column-aligned; callers that pass neither
  // prop (undefined) render no cell.
  const showMarkers = unseen !== undefined || draftReady !== undefined

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
      {showMarkers && (
        <td className="pl-6 pr-1 py-3 w-9 align-middle whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            {unseen && (
              <span
                className="inline-block w-2 h-2 rounded-full bg-violet-500"
                aria-label="Unseen activity"
                title="Unseen customer activity"
              />
            )}
            {draftReady && (
              <span className="inline-flex" title="AI draft ready" aria-label="AI draft ready">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
              </span>
            )}
          </span>
        </td>
      )}
      {children}
    </tr>
  )
}
