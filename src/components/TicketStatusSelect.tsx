'use client'

import { useRef, useTransition, type MouseEvent } from 'react'
import { updateTicketStatus } from '@/app/(app)/(dashboard)/actions/tickets'

type Status = 'open' | 'pending' | 'closed'

const STATUS_COLORS: Record<Status, string> = {
  open:    'bg-amber-500/10 text-amber-300 border-amber-500/30',
  pending: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  closed:  'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const SIZES = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
} as const

export default function TicketStatusSelect({
  ticketId,
  value,
  size = 'sm',
}: {
  ticketId: string
  value:    Status
  size?:    keyof typeof SIZES
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function stopPropagation(e: MouseEvent) {
    // Prevent the surrounding row link from intercepting the click.
    e.stopPropagation()
  }

  return (
    <form ref={formRef} action={updateTicketStatus} onClick={stopPropagation}>
      <input type="hidden" name="ticket_id" value={ticketId} />
      <select
        name="status"
        defaultValue={value}
        disabled={pending}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={`appearance-none rounded-full border font-medium capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 ${SIZES[size]} ${STATUS_COLORS[value]}`}
      >
        <option value="open"    className="bg-pvx-surface text-white">Open</option>
        <option value="pending" className="bg-pvx-surface text-white">Pending</option>
        <option value="closed"  className="bg-pvx-surface text-white">Closed</option>
      </select>
    </form>
  )
}
