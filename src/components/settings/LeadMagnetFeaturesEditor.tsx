'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'
import { updateLeadMagnetFeatures } from '@/app/(app)/(dashboard)/actions/lead-support'

// Mirrors the HQ-side cap (`parseFeatures` slice) so the limit is
// consistent across surfaces. The HQ editor used to enforce this; with
// the editor moved to the org side, the cap moves with it.
export const MAX_FEATURES = 50

type Props = {
  initial: string[]
}

type ActionState =
  | { status: 'ok' }
  | { status: 'error'; error: string }
  | null

const BTN         = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const TEXTAREA    = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500'

export default function LeadMagnetFeaturesEditor({ initial }: Props) {
  // Local text state lets us drive the dirty/saved indicator and the
  // inline "X / 50" counter without round-tripping through the server.
  const initialText = initial.join('\n')
  const [text, setText] = useState<string>(initialText)
  const lastSavedRef = useRef<string>(initialText)
  const isDirty = text !== lastSavedRef.current

  const linesCount = useMemo(
    () => text.split('\n').map((l) => l.trim()).filter(Boolean).length,
    [text],
  )
  const overCap = linesCount > MAX_FEATURES

  // The action contract is `(formData) => Result`; useActionState wants a
  // 2-arg reducer, so we adapt with a thin wrapper. Keeps the action
  // signature clean for non-hook callers.
  const [state, action, pending] = useActionState<ActionState, FormData>(
    async (_prev, formData) => updateLeadMagnetFeatures(formData),
    null,
  )

  useEffect(() => {
    if (state?.status === 'ok') lastSavedRef.current = text
    // Only re-snapshot when the action confirms success; intentionally
    // not depending on `text` here so we don't snapshot mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2 text-violet-300">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Page Features</h3>
          <p className="text-xs text-gray-500 mt-1">
            These bullet points appear on your lead-magnet page under the headline. One feature per line.
          </p>
        </div>
      </div>

      <form action={action} className="space-y-3">
        <textarea
          name="features"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={'Free eligibility check\nSame-day installer match\n…'}
          className={TEXTAREA}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500">
            {linesCount} / {MAX_FEATURES}
            {overCap && (
              <span className="ml-2 text-rose-300">Maximum {MAX_FEATURES} features</span>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || !isDirty || overCap}
            className={BTN_PRIMARY}
          >
            {pending ? 'Saving…' : isDirty ? 'Save features' : 'Saved'}
          </button>
        </div>

        {state?.status === 'error' && (
          <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
        {state?.status === 'ok' && !isDirty && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{linesCount > 0 ? `Saved ${linesCount} feature${linesCount === 1 ? '' : 's'}.` : 'Features cleared.'}</span>
          </div>
        )}
      </form>
    </div>
  )
}
