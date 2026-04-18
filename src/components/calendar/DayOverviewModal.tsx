'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Plus, X, Clock, MapPin } from 'lucide-react'
import CopyId from '@/components/CopyId'
import type { CalAppt } from './CalendarCore'

export type DayOverviewModalHandle = {
  openForDay: (day: Date, appts: CalAppt[]) => void
}

interface Props {
  onSelectAppt: (appt: CalAppt) => void
  onNewForDay:  (day: Date) => void
  ref?:         Ref<DayOverviewModalHandle>
}

const STATUS_COLORS: Record<CalAppt['status'], string> = {
  scheduled: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
}

function fmtTime12(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function DayOverviewModal({ onSelectAppt, onNewForDay, ref }: Props) {
  const [day, setDay]     = useState<Date | null>(null)
  const [rows, setRows]   = useState<CalAppt[]>([])
  const dialogRef = useRef<HTMLDialogElement>(null)

  useImperativeHandle(ref, () => ({
    openForDay(d, appts) {
      setDay(d)
      setRows([...appts].sort((a, b) => a.start_at.localeCompare(b.start_at)))
      dialogRef.current?.showModal()
    },
  }), [])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg) return
    const handler = () => { setDay(null); setRows([]) }
    dlg.addEventListener('close', handler)
    return () => dlg.removeEventListener('close', handler)
  }, [])

  function close() {
    dialogRef.current?.close()
  }

  function handleSelect(a: CalAppt) {
    close()
    // Let the dialog finish closing before the parent opens the next one
    queueMicrotask(() => onSelectAppt(a))
  }

  function handleNew() {
    if (!day) return
    const d = new Date(day); d.setHours(9, 0, 0, 0)
    close()
    queueMicrotask(() => onNewForDay(d))
  }

  const label = day
    ? day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-0 text-white shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-pvx-border">
        <div>
          <h2 className="text-base font-semibold">{label}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{rows.length} appointment{rows.length === 1 ? '' : 's'}</p>
        </div>
        <button type="button" onClick={close} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="max-h-[60vh] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">No appointments on this day.</div>
        ) : (
          <ul className="divide-y divide-pvx-border">
            {rows.map(a => (
              <li key={a.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(a)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelect(a)
                    }
                  }}
                  className="w-full text-left px-5 py-3 hover:bg-violet-500/5 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <span className="text-sm font-medium text-white truncate">{a.title}</span>
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${STATUS_COLORS[a.status]}`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-500" />
                      {fmtTime12(a.start_at)}{a.end_at ? ` – ${fmtTime12(a.end_at)}` : ''}
                    </span>
                    {a.location && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 text-gray-500" />
                        <span className="truncate">{a.location}</span>
                      </span>
                    )}
                    {a.display_id && (
                      <span className="ml-auto text-[10px]">
                        <CopyId id={a.display_id} />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5 py-3 border-t border-pvx-border">
        <button
          type="button"
          onClick={handleNew}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-pvx-border bg-transparent px-3 py-2 text-xs font-medium text-gray-300 hover:text-white hover:border-violet-500/40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New appointment on this day
        </button>
      </div>
    </dialog>
  )
}
