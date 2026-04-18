'use client'

import { useState, useRef, useTransition } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { saveWidgetConfig } from '@/app/(dashboard)/actions/dashboard'
import type { WidgetDef } from '@/lib/widgets'

interface Props {
  allWidgets:    WidgetDef[]
  hiddenWidgets: string[]
}

export default function WidgetCustomizer({ allWidgets, hiddenWidgets }: Props) {
  const [hidden, setHidden]     = useState<Set<string>>(new Set(hiddenWidgets))
  const [isPending, startTrans] = useTransition()
  const dialogRef               = useRef<HTMLDialogElement>(null)

  function open() {
    setHidden(new Set(hiddenWidgets)) // always reset to last-saved state
    dialogRef.current?.showModal()
  }

  function toggle(id: string) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function save() {
    startTrans(async () => {
      await saveWidgetConfig(Array.from(hidden))
      dialogRef.current?.close()
    })
  }

  return (
    <>
      <button
        onClick={open}
        title="Customize dashboard"
        className="inline-flex items-center gap-1.5 rounded-lg border border-pvx-border bg-pvx-surface px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Customize
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-sm rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">Customize Widgets</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Toggle which stat cards appear on your dashboard.</p>

        <div className="space-y-2">
          {allWidgets.map(w => (
            <label
              key={w.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-pvx-border hover:bg-white/5 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={!hidden.has(w.id)}
                onChange={() => toggle(w.id)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-violet-500"
              />
              <span className="text-sm text-gray-200">{w.label}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between mt-5">
          <button
            type="button"
            onClick={() => setHidden(new Set())}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Show all
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
