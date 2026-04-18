'use client'

import { useMemo, useState } from 'react'

type Appt = { start_at: string }

interface Props {
  appointments?: Appt[]
}

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function startOfWeek(d: Date): Date { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x }
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MiniCalendar({ appointments = [] }: Props) {
  const [today] = useState(() => startOfDay(new Date()))

  const keysWithAppts = useMemo(() => {
    const s = new Set<string>()
    for (const a of appointments) s.add(dateKey(new Date(a.start_at)))
    return s
  }, [appointments])

  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const start = startOfWeek(firstOfMonth)
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-4">
      <h3 className="text-sm font-semibold text-white mb-3">
        {MONTH_FULL[today.getMonth()]} {today.getFullYear()}
      </h3>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WD.map((d, i) => (
          <div key={i} className="text-[10px] text-center text-gray-500 py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map(d => {
          const inMonth = d.getMonth() === today.getMonth()
          const isToday = sameDay(d, today)
          const hasAppts = keysWithAppts.has(dateKey(d))
          return (
            <div
              key={dateKey(d)}
              className={`relative aspect-square flex items-center justify-center text-[11px] rounded-md transition-colors ${
                !inMonth ? 'text-gray-700'
                  : isToday ? 'bg-violet-600 text-white font-semibold'
                  : hasAppts ? 'text-violet-200'
                  : 'text-gray-400'
              }`}
            >
              {d.getDate()}
              {hasAppts && !isToday && inMonth && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-400" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
