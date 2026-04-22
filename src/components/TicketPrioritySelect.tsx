'use client'

import { useRef, useTransition, type MouseEvent } from 'react'
import { updateTicketPriority } from '@/app/(app)/(dashboard)/actions/tickets'

type Priority = 'low' | 'medium' | 'high'

const PRIORITY_COLORS: Record<Priority, string> = {
  high:   'bg-red-500/10 text-red-300 border-red-500/30',
  medium: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
  low:    'bg-gray-500/10 text-gray-400 border-gray-500/30',
}

const SIZES = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
} as const

export default function TicketPrioritySelect({
  ticketId,
  value,
  size = 'sm',
}: {
  ticketId: string
  value:    Priority
  size?:    keyof typeof SIZES
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function stopPropagation(e: MouseEvent) {
    // Prevent the surrounding row click from firing when interacting with the select.
    e.stopPropagation()
  }

  return (
    <form ref={formRef} action={updateTicketPriority} onClick={stopPropagation}>
      <input type="hidden" name="ticket_id" value={ticketId} />
      <select
        name="priority"
        defaultValue={value}
        disabled={pending}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={`appearance-none rounded-full border font-medium capitalize cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 ${SIZES[size]} ${PRIORITY_COLORS[value]}`}
      >
        <option value="high"   className="bg-pvx-surface text-white">High</option>
        <option value="medium" className="bg-pvx-surface text-white">Medium</option>
        <option value="low"    className="bg-pvx-surface text-white">Low</option>
      </select>
    </form>
  )
}
