'use client'

import { useOptimistic, useTransition, useState } from 'react'
import { AlertTriangle, Radar } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { updateCaptureStatus } from '@/app/(app)/(admin)/hq/actions/organizations'

type Props = {
  orgId:           string
  initialEnabled:  boolean
}

// HQ-side master kill switch for tenant signal capture. Optimistic UI:
// flip the visual state instantly under startTransition, await the
// server action, and roll back if it returns ok:false. The yellow
// "CAPTURE PAUSED" badge tracks the optimistic value too — surface
// feedback follows the toggle, not the network round-trip.
export default function OrgCaptureToggle({ orgId, initialEnabled }: Props) {
  const [serverEnabled, setServerEnabled] = useState(initialEnabled)
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(serverEnabled)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleToggle(next: boolean) {
    setError(null)
    startTransition(async () => {
      setOptimisticEnabled(next)
      const result = await updateCaptureStatus(orgId, next)
      if (result.ok) {
        setServerEnabled(next)
      } else {
        // Optimistic value auto-reverts when the transition completes
        // without a setServerEnabled call. Surface the reason.
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-pvx-border bg-black/25 p-4">
        <div className="flex items-start gap-3 min-w-0">
          <Radar className="w-4 h-4 mt-0.5 shrink-0 text-violet-300" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              Signal Capture Status
            </div>
            <p className="mt-0.5 text-xs text-gray-400">
              Master kill switch for <span className="font-mono">ai_listening_enabled</span>. When off,
              the capture &amp; ingest routes drop this org's signals before any AI scoring.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-medium uppercase tracking-wider ${
              optimisticEnabled ? 'text-emerald-300' : 'text-gray-500'
            }`}
          >
            {optimisticEnabled ? 'On' : 'Off'}
          </span>
          <Switch
            checked={optimisticEnabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
            aria-label="Signal capture status"
          />
        </div>
      </div>

      {!optimisticEnabled && (
        <div className="flex items-start gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold uppercase tracking-wider">Capture Paused:</span>{' '}
            AI is not listening for this tenant.
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Could not update capture status: {error}</span>
        </div>
      )}
    </div>
  )
}
