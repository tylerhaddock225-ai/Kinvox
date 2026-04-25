'use client'

import { useTransition, useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { unlockSignal, type UnlockSignalState } from '@/app/(app)/(dashboard)/actions/signals'

export default function SignalUnlockButton({ signalId }: { signalId: string }) {
  const [pending, startTransition] = useTransition()
  const [state, setState]          = useState<UnlockSignalState>(null)
  const router                     = useRouter()

  function onClick() {
    startTransition(async () => {
      const result = await unlockSignal(signalId)
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
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-xs font-semibold text-white transition-colors"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
        {pending ? 'Unlocking…' : 'Unlock Intent (1 Credit)'}
      </button>
      {errorMsg && (
        <span className="text-[11px] text-rose-300">{errorMsg}</span>
      )}
    </div>
  )
}
