'use client'

import { useRef, useTransition, type MouseEvent } from 'react'
import { updateHQTicketCategory } from '@/app/(app)/(admin)/admin-hq/actions/tickets'

type HQCategory = 'bug' | 'billing' | 'feature_request' | 'question'

const LABEL: Record<HQCategory, string> = {
  bug:              'Bug',
  billing:          'Billing',
  feature_request:  'Feature',
  question:         'Question',
}

const COLORS: Record<HQCategory, string> = {
  bug:              'bg-rose-500/10 text-rose-300 border-rose-500/30',
  billing:          'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  feature_request:  'bg-violet-500/10 text-violet-300 border-violet-500/30',
  question:         'bg-sky-500/10 text-sky-300 border-sky-500/30',
}

// Mirrors TicketStatusSelect / TicketPrioritySelect styling for visual
// consistency across the grid: pill-shaped color-chip select that auto-
// submits on change.
export default function HQCategorySelect({
  ticketId,
  value,
}: {
  ticketId: string
  value:    HQCategory
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation()
  }

  return (
    <form ref={formRef} action={updateHQTicketCategory} onClick={stopPropagation}>
      <input type="hidden" name="ticket_id" value={ticketId} />
      <select
        name="hq_category"
        defaultValue={value}
        disabled={pending}
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={`appearance-none rounded-full border font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 text-xs px-2 py-0.5 ${COLORS[value]}`}
      >
        <option value="bug"             className="bg-pvx-surface text-white">{LABEL.bug}</option>
        <option value="billing"         className="bg-pvx-surface text-white">{LABEL.billing}</option>
        <option value="feature_request" className="bg-pvx-surface text-white">{LABEL.feature_request}</option>
        <option value="question"        className="bg-pvx-surface text-white">{LABEL.question}</option>
      </select>
    </form>
  )
}
