'use client'

import { useTransition } from 'react'
import { updateLeadStatus } from '@/app/(app)/(dashboard)/actions/leads'
import type { Lead } from '@/lib/types/database.types'

const OPTIONS: { value: Lead['status']; label: string }[] = [
  { value: 'new',       label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost',      label: 'Lost' },
]

interface Props {
  leadId:        string
  initialStatus: Lead['status']
}

export default function LeadStatusSelect({ leadId, initialStatus }: Props) {
  const [pending, startTrans] = useTransition()

  return (
    <div className="relative">
      <select
        defaultValue={initialStatus}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          startTrans(async () => {
            await updateLeadStatus(leadId, next)
          })
        }}
        className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-60"
      >
        {OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {pending && (
        <span className="absolute right-9 top-1/2 -translate-y-1/2 text-xs text-gray-500">Saving…</span>
      )}
    </div>
  )
}
