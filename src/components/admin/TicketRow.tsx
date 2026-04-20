'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

export default function TicketRow({
  ticketId,
  children,
}: {
  ticketId: string
  children: ReactNode
}) {
  const router = useRouter()
  const href = `/admin-hq/tickets/${ticketId}`

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          router.push(href)
        }
      }}
      className="cursor-pointer transition-colors hover:bg-slate-700/30 focus:bg-slate-700/30 focus:outline-none"
    >
      {children}
    </tr>
  )
}
