'use client'

import { useTransition } from 'react'
import { updateCustomerStatus, type CustomerStatus } from '@/app/(dashboard)/actions/customers'

const OPTIONS: { value: CustomerStatus; label: string }[] = [
  { value: 'active',     label: 'Active' },
  { value: 'pending',    label: 'Pending' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'completed',  label: 'Completed' },
]

interface Props {
  customerId:    string
  initialStatus: CustomerStatus
}

export default function CustomerStatusSelect({ customerId, initialStatus }: Props) {
  const [pending, startTrans] = useTransition()

  return (
    <div className="relative">
      <select
        defaultValue={initialStatus}
        disabled={pending}
        onChange={e => {
          const next = e.target.value
          startTrans(async () => {
            await updateCustomerStatus(customerId, next)
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
