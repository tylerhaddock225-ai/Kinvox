'use client'

import { useState, useTransition } from 'react'
import { Unplug, AlertCircle, X } from 'lucide-react'
import {
  disconnectSocialPlatform,
  type DisconnectSocialState,
} from '@/app/(app)/(dashboard)/actions/social'
import { Button } from '@/components/ui/button'

type Props = { platform: 'reddit' | 'x' | 'facebook' | 'threads' }

// Two-step disconnect to avoid mis-clicks revoking a credential a tenant
// just connected. First click reveals "Confirm" + "Cancel"; only the
// second click fires the server action. Auto-resets to the idle state
// after 6 seconds of no interaction so abandoned confirms don't loiter.
export default function DisconnectButton({ platform }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [pending, startTransition]  = useTransition()

  function arm() {
    setError(null)
    setConfirming(true)
    // Auto-cancel after 6s so the page doesn't sit in "are you sure?" forever.
    window.setTimeout(() => setConfirming(false), 6_000)
  }

  function fire() {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('platform', platform)
      const result: DisconnectSocialState = await disconnectSocialPlatform(null, fd)
      if (result?.status === 'error') {
        setError(result.error)
        setConfirming(false)
        return
      }
      // Success: server action revalidates the page; the connected card
      // will re-render as "Not connected" on the next React tick.
      setConfirming(false)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!confirming ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={arm}
          disabled={pending}
        >
          <Unplug className="mr-1.5" />
          {pending ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={fire}
            disabled={pending}
          >
            <Unplug className="mr-1.5" />
            {pending ? 'Disconnecting…' : 'Confirm Disconnect'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            <X />
          </Button>
        </div>
      )}
      {error && (
        <span className="inline-flex items-center gap-1 text-[11px] text-rose-300">
          <AlertCircle className="w-3 h-3" />
          {error}
        </span>
      )}
    </div>
  )
}
