'use client'

import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

export default function TicketsRow({
  ticketId,
  children,
}: {
  ticketId: string
  children: ReactNode
}) {
  const router = useRouter()

  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    // Ignore clicks that originated on an interactive child (link, button,
    // select, input). Those targets should run their own handler instead of
    // navigating away.
    const target = e.target as HTMLElement
    if (target.closest('a, button, select, input, label')) return
    router.push(`/tickets/${ticketId}`)
  }

  return (
    <tr
      onClick={handleClick}
      className="cursor-pointer hover:bg-violet-400/[0.07] transition-colors"
    >
      {children}
    </tr>
  )
}
