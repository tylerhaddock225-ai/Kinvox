'use client'

import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import type { PendingSignal } from '@/lib/types/database.types'
import SignalCard from './SignalCard'

type Props = {
  organizationId: string
  initial:        PendingSignal[]
}

/**
 * Subscribes to postgres_changes on public.pending_signals so new rows
 * appear without a reload, and in-flight rows move off when their status
 * changes to approved/dismissed. The SELECT filter (status='pending') is
 * applied in-memory — realtime doesn't support server-side predicate
 * filtering on postgres_changes payloads in the client lib. RLS ensures
 * we only ever get rows for orgs the session can see anyway.
 */
export default function SignalsBoard({ organizationId, initial }: Props) {
  const [signals, setSignals] = useState<PendingSignal[]>(initial)

  useEffect(() => {
    const channel = supabase
      .channel(`pending_signals:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'pending_signals',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as PendingSignal
            if (row.status !== 'pending') return
            setSignals((prev) => {
              if (prev.some((s) => s.id === row.id)) return prev
              return [row, ...prev]
            })
            return
          }

          if (payload.eventType === 'UPDATE') {
            const row = payload.new as PendingSignal
            setSignals((prev) => {
              // Any transition away from 'pending' drops the card off
              // the queue — it got approved or dismissed.
              if (row.status !== 'pending') {
                return prev.filter((s) => s.id !== row.id)
              }
              return prev.map((s) => (s.id === row.id ? row : s))
            })
            return
          }

          if (payload.eventType === 'DELETE') {
            const row = payload.old as Partial<PendingSignal>
            if (!row?.id) return
            setSignals((prev) => prev.filter((s) => s.id !== row.id))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [organizationId])

  /** Called by SignalCard after a successful send/dismiss, so the local
      list reflects the change immediately — before the realtime echo. */
  function removeLocal(id: string) {
    setSignals((prev) => prev.filter((s) => s.id !== id))
  }

  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface/40 p-10 text-center space-y-2">
        <Inbox className="w-8 h-8 text-gray-600 mx-auto" />
        <h2 className="text-sm font-semibold text-white">No pending signals</h2>
        <p className="text-xs text-gray-500">
          New signals arrive live — this page updates the moment the AI agent captures one.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {signals.map((s) => (
        <SignalCard key={s.id} signal={s} onRemove={removeLocal} />
      ))}
    </div>
  )
}
