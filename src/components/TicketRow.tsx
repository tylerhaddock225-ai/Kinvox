'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

export default function TicketRow({
  href,
  children,
}: {
  href:     string
  children: ReactNode
}) {
  const router = useRouter()

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
      className="cursor-pointer transition-colors hover:bg-white/5 focus:bg-white/5 focus:outline-none"
    >
      {children}
    </tr>
  )
}
