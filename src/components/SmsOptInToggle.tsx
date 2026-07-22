'use client'

import { useState, useTransition } from 'react'
import { MessageSquare } from 'lucide-react'
import { setCustomerSmsOptIn } from '@/app/(app)/(dashboard)/actions/customers'
import { setLeadSmsOptIn } from '@/app/(app)/(dashboard)/actions/leads'

// SMS Stage 2a — compact org-side SMS consent toggle for the customer + lead
// detail pages. Flipping ON records manual consent ("gave consent by phone");
// OFF clears it. Optimistic: the switch flips immediately and the server action
// reconciles via revalidation. NOTHING is sent — this only records consent state.
export default function SmsOptInToggle({
  kind,
  id,
  optedIn,
  optedInAt,
}: {
  kind:      'customer' | 'lead'
  id:        string
  optedIn:   boolean
  optedInAt: string | null
}) {
  const [on, setOn] = useState(optedIn)
  const [pending, startTransition] = useTransition()
  const noun = kind === 'customer' ? 'customer' : 'lead'

  function toggle() {
    const next = !on
    setOn(next) // optimistic
    startTransition(async () => {
      if (kind === 'customer') await setCustomerSmsOptIn(id, next)
      else                     await setLeadSmsOptIn(id, next)
    })
  }

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
          <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
          SMS Messaging
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="SMS opt-in"
          disabled={pending}
          onClick={toggle}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            on ? 'bg-violet-600' : 'bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              on ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {on ? (
        <p className="text-xs text-emerald-300/90">
          Opted in{optedInAt ? ` ${new Date(optedInAt).toLocaleDateString()}` : ''}
        </p>
      ) : (
        <p className="text-xs text-gray-500 leading-relaxed">
          Turn on only if the {noun} gave consent (e.g., by phone). Until then, this {noun} gets email only.
        </p>
      )}
    </div>
  )
}
