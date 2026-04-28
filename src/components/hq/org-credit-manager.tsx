'use client'

import { useState } from 'react'
import { Wallet, Plus, Zap, AlertCircle, CheckCircle2 } from 'lucide-react'
import { addCredits, updateAutoTopUp } from '@/app/(app)/(admin)/hq/actions/credits'

type CreditsRow = {
  balance:              number
  auto_top_up_enabled:  boolean
  top_up_threshold:     number | null
  top_up_amount:        number | null
}

type Props = {
  orgId:    string
  credits:  CreditsRow
  flash?: {
    creditsAdded?: number | null
    topUpSaved?:   boolean
    error?:        string | null
  }
}

const QUICK_ADDS = [10, 50, 100] as const

export default function OrgCreditManager({ orgId, credits, flash }: Props) {
  const [enabled, setEnabled] = useState<boolean>(credits.auto_top_up_enabled)

  return (
    <div className="space-y-5">
      {flash?.creditsAdded ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            {flash.creditsAdded > 0 ? '+' : ''}
            {flash.creditsAdded} credits recorded to the ledger.
          </span>
        </div>
      ) : null}
      {flash?.topUpSaved ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Auto-top-up settings saved.</span>
        </div>
      ) : null}
      {flash?.error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{flash.error}</span>
        </div>
      ) : null}

      {/* Balance */}
      <div className="flex items-end justify-between gap-4 rounded-lg border border-pvx-border bg-pvx-surface/40 p-5">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Current Balance
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold text-white tabular-nums">
              {credits.balance.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">signals</span>
          </div>
        </div>
        <Wallet className="w-8 h-8 text-violet-300/40" />
      </div>

      {/* Quick add */}
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-2">
          Quick Add
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_ADDS.map((n) => (
            <form key={n} action={addCredits}>
              <input type="hidden" name="org_id" value={orgId} />
              <input type="hidden" name="amount" value={String(n)} />
              <input type="hidden" name="type"   value="purchase" />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-violet-700/60 bg-violet-950/40 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-900/40 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {n}
              </button>
            </form>
          ))}

          {/* Custom amount — doubles as a refund/adjustment path */}
          <form action={addCredits} className="flex items-center gap-1.5">
            <input type="hidden" name="org_id" value={orgId} />
            <input
              name="amount"
              type="number"
              step={1}
              placeholder="Custom"
              className="w-24 rounded-md bg-pvx-surface border border-pvx-border px-2 py-1.5 text-xs text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
            <select
              name="type"
              defaultValue="purchase"
              className="rounded-md bg-pvx-surface border border-pvx-border px-2 py-1.5 text-xs text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            >
              <option value="purchase">purchase</option>
              <option value="refund">refund</option>
              <option value="adjustment">adjustment</option>
            </select>
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-pvx-border bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-gray-200 hover:bg-pvx-surface transition-colors"
            >
              Apply
            </button>
          </form>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Every change writes to <span className="font-mono">credit_ledger</span>. Negatives allowed for manual deductions.
        </p>
      </div>

      {/* Auto-top-up */}
      <form action={updateAutoTopUp} className="rounded-lg border border-pvx-border bg-gray-900 p-4 space-y-3">
        <input type="hidden" name="org_id" value={orgId} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-300" />
            <div>
              <div className="text-sm font-semibold text-white">Auto-Top-Up</div>
              <div className="text-[11px] text-gray-500">
                When balance drops below threshold, add top-up amount and log a purchase.
              </div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="w-10 h-5 rounded-full bg-pvx-surface border border-pvx-border peer-checked:bg-violet-600 peer-checked:border-violet-500 transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-gray-400 peer-checked:bg-white peer-checked:translate-x-5 transition-transform" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
              Threshold
            </span>
            <input
              name="threshold"
              type="number"
              min={0}
              step={1}
              defaultValue={credits.top_up_threshold ?? ''}
              disabled={!enabled}
              placeholder="e.g. 10"
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40 disabled:opacity-50"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
              Top-Up Amount
            </span>
            <input
              name="top_up_amount"
              type="number"
              min={1}
              step={1}
              defaultValue={credits.top_up_amount ?? ''}
              disabled={!enabled}
              placeholder="e.g. 100"
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 tabular-nums focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40 disabled:opacity-50"
            />
          </label>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Save settings
          </button>
        </div>
      </form>
    </div>
  )
}
