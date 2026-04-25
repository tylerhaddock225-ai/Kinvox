'use client'

import { useTransition, useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { unlockLead, type UnlockLeadState } from '@/app/(app)/(dashboard)/actions/leads'

export default function UnlockButton({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition()
  const [state, setState]          = useState<UnlockLeadState>(null)
  const router                     = useRouter()

  function onClick(e: React.MouseEvent) {
    // The row is unclickable while locked, but defense-in-depth: keep the
    // click from bubbling to any future ancestor handler that might add
    // navigation later.
    e.stopPropagation()
    startTransition(async () => {
      const result = await unlockLead(leadId)
      setState(result)
      if (result?.status === 'success') router.refresh()
    })
  }

  const errorMsg =
    state?.status === 'error'
      ? state.reason === 'insufficient_credits'
        ? 'Insufficient credits — top up to unlock.'
        : state.error
      : null

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-semibold text-white transition-colors"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
        {pending ? 'Unlocking…' : 'Unlock Lead (1 Credit)'}
      </button>
      {errorMsg && (
        <span className="text-[10px] text-rose-300">{errorMsg}</span>
      )}
    </div>
  )
}
