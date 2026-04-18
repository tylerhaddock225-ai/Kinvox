'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import CreateAppointmentModal, {
  type CreateAppointmentModalHandle,
} from '@/components/CreateAppointmentModal'
import EditAppointmentModal, {
  type EditAppointmentModalHandle,
} from './EditAppointmentModal'
import DayOverviewModal, {
  type DayOverviewModalHandle,
} from './DayOverviewModal'

export type CalAppt = {
  id:          string
  display_id:  string | null
  title:       string
  start_at:    string
  end_at:      string | null
  status:      'scheduled' | 'completed' | 'cancelled'
  description: string | null
  location:    string | null
  assigned_to: string | null
  lead_id:     string | null
}

type Member = { id: string; full_name: string | null }
type Lead   = { id: string; first_name: string; last_name: string | null }

type View = 'day' | 'week' | 'month' | 'year' | 'decade'

interface Props {
  appointments: CalAppt[]
  members:      Member[]
  leads:        Lead[]
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function addYears(d: Date, n: number): Date { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x }
function addMonths(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()
  x.setDate(Math.min(d.getDate(), lastDay))
  return x
}
function startOfWeek(d: Date): Date { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1) }
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toDtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtHour12(h: number): string {
  const d = new Date(); d.setHours(h, 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric' })
}
function fmtTime12(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_START_H = 0
const DAY_END_H   = 23
const DAY_HOURS   = Array.from({ length: DAY_END_H - DAY_START_H + 1 }, (_, i) => DAY_START_H + i)
const HOUR_PX     = 56                                             // h-14 per hour
const GRID_MAX_H  = 700                                            // scrollable window height
const HEADER_PX   = 54                                             // sticky header height
const DEFAULT_SCROLL_HOUR = 8                                      // 8 AM on load
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const WD_SHORT    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const VIEWS: { key: View; label: string }[] = [
  { key: 'day',    label: 'Day' },
  { key: 'week',   label: 'Week' },
  { key: 'month',  label: 'Month' },
  { key: 'year',   label: 'Year' },
  { key: 'decade', label: 'Decade' },
]

// ── Main component ───────────────────────────────────────────────────────────

export default function CalendarCore({ appointments, members, leads }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  // Read URL params ONCE at mount so the first render is already on the right
  // day/view — no flash from month→day after an effect fires.
  const [cursor, setCursor] = useState<Date>(() => {
    const d = searchParams.get('d')
    if (d) {
      const target = new Date(d)
      if (!Number.isNaN(target.getTime())) return startOfDay(target)
    }
    return startOfDay(new Date())
  })
  const [view, setView] = useState<View>(() => {
    // Any search-driven open forces Day view so the target block is visible.
    return searchParams.get('open') ? 'day' : 'month'
  })

  const [draft, setDraft]   = useState<{ dayKey: string; startMin: number; endMin: number } | null>(null)
  const [now, setNow]       = useState<Date>(() => new Date())
  const modalRef    = useRef<CreateAppointmentModalHandle>(null)
  const editRef     = useRef<EditAppointmentModalHandle>(null)
  const overviewRef = useRef<DayOverviewModalHandle>(null)
  const openedIdRef = useRef<string | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || openedIdRef.current === openId) return

    // The initial render already has cursor + view aligned via lazy-init; for
    // URL changes after mount, catch those up here before opening the modal.
    const dParam = searchParams.get('d')
    const iso    = dParam || appointments.find(a => a.id === openId)?.start_at
    if (iso) {
      const target = new Date(iso)
      if (!Number.isNaN(target.getTime())) {
        setCursor(startOfDay(target))
        setView('day')
      }
    }

    const match = appointments.find(a => a.id === openId)
    openedIdRef.current = openId
    if (match) editRef.current?.openWithAppointment(match)

    // Strip one-shot params so reload / back-nav doesn't re-trigger.
    const next = new URLSearchParams(searchParams.toString())
    next.delete('open')
    next.delete('d')
    const qs = next.toString()
    router.replace(qs ? `/appointments?${qs}` : '/appointments', { scroll: false })
  }, [searchParams, appointments, router])

  const today = startOfDay(now)

  const byDay = useMemo(() => {
    const m = new Map<string, CalAppt[]>()
    for (const a of appointments) {
      const k = dateKey(new Date(a.start_at))
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(a)
    }
    return m
  }, [appointments])

  const byYear = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of appointments) {
      const y = new Date(a.start_at).getFullYear()
      m.set(y, (m.get(y) ?? 0) + 1)
    }
    return m
  }, [appointments])

  function shift(dir: -1 | 1) {
    setCursor(c => {
      switch (view) {
        case 'day':    return addDays(c, dir)
        case 'week':   return addDays(c, 7 * dir)
        case 'month':  return addMonths(c, dir)
        case 'year':   return addYears(c, dir)
        case 'decade': return addYears(c, 10 * dir)
      }
    })
  }

  function openNewAt(d: Date) {
    modalRef.current?.openWithStart(toDtLocal(d))
  }

  function openSlot(d: Date) {
    const startMin = (d.getHours() - DAY_START_H) * 60 + d.getMinutes()
    setDraft({ dayKey: dateKey(d), startMin, endMin: startMin + 60 })
    modalRef.current?.openWithStart(toDtLocal(d))
  }

  function openEdit(a: CalAppt) {
    editRef.current?.openWithAppointment(a)
  }

  function openDayOverview(d: Date, appts: CalAppt[]) {
    overviewRef.current?.openForDay(d, appts)
  }

  const label = (() => {
    if (view === 'day') {
      return cursor.toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    }
    if (view === 'week') {
      const s = startOfWeek(cursor); const e = addDays(s, 6)
      const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
      return `${s.toLocaleDateString(undefined, o)} – ${e.toLocaleDateString(undefined, o)}, ${e.getFullYear()}`
    }
    if (view === 'month')  return `${MONTH_FULL[cursor.getMonth()]} ${cursor.getFullYear()}`
    if (view === 'year')   return String(cursor.getFullYear())
    const start = Math.floor(cursor.getFullYear() / 10) * 10
    return `${start} – ${start + 9}`
  })()

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-pvx-border">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} title="Previous" className="p-2 rounded-lg border border-pvx-border text-gray-400 hover:text-white hover:border-violet-500/40 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setCursor(startOfDay(new Date()))} className="px-3 py-1.5 text-xs font-medium rounded-lg border border-pvx-border text-gray-300 hover:text-white hover:border-violet-500/40 transition-colors">
            Today
          </button>
          <button onClick={() => shift(1)} title="Next" className="p-2 rounded-lg border border-pvx-border text-gray-400 hover:text-white hover:border-violet-500/40 transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="ml-3 text-sm font-semibold text-white">{label}</h2>
        </div>

        <div className="inline-flex rounded-lg border border-pvx-border p-0.5 bg-pvx-bg/40">
          {VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                view === v.key
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* View body */}
      <div className="p-4">
        {view === 'day'    && <DayView    cursor={cursor} byDay={byDay} onSlotClick={openSlot}  onEditAppt={openEdit} today={today} now={now} draft={draft} />}
        {view === 'week'   && <WeekView   cursor={cursor} byDay={byDay} onSlotClick={openSlot}  onEditAppt={openEdit} today={today} now={now} draft={draft} />}
        {view === 'month'  && <MonthView  cursor={cursor} byDay={byDay} onCellClick={openNewAt} onEditAppt={openEdit} onMorePill={openDayOverview} today={today} />}
        {view === 'year'   && <YearView   cursor={cursor} byDay={byDay} today={today} onMonthClick={(m) => { setCursor(new Date(cursor.getFullYear(), m, 1)); setView('month') }} />}
        {view === 'decade' && <DecadeView cursor={cursor} byYear={byYear} today={today} onYearClick={(y) => { setCursor(new Date(y, 0, 1)); setView('year') }} />}
      </div>

      <CreateAppointmentModal
        ref={modalRef}
        hideTrigger
        members={members}
        leads={leads}
        onClose={() => setDraft(null)}
      />
      <EditAppointmentModal
        ref={editRef}
        members={members}
        leads={leads}
      />
      <DayOverviewModal
        ref={overviewRef}
        onSelectAppt={openEdit}
        onNewForDay={openNewAt}
      />
    </div>
  )
}

// ── Hour legend (shared by Day / Week) ───────────────────────────────────────

function HourLegend() {
  return (
    <div className="w-14 shrink-0">
      <div
        className="sticky top-0 z-40 bg-pvx-surface border-b border-pvx-border"
        style={{ height: `${HEADER_PX}px` }}
      />
      {DAY_HOURS.map(h => (
        <div key={h} className="h-14 text-[10px] text-gray-500 px-1 pt-0.5 border-b border-pvx-border/60">
          {fmtHour12(h)}
        </div>
      ))}
    </div>
  )
}

function HourColumn({
  date, byDay, onSlotClick, onEditAppt, today, now, draft,
}: {
  date: Date
  byDay: Map<string, CalAppt[]>
  onSlotClick: (d: Date) => void
  onEditAppt:  (a: CalAppt) => void
  today: Date
  now: Date
  draft: { dayKey: string; startMin: number; endMin: number } | null
}) {
  const isToday       = sameDay(date, today)
  const dayKeyStr     = dateKey(date)
  // Match appointments by local YYYY-MM-DD — avoids any UTC offset surprises.
  const dayAppts      = (byDay.get(dayKeyStr) ?? []).filter(
    a => dateKey(new Date(a.start_at)) === dayKeyStr,
  )
  const gridPx        = DAY_HOURS.length * HOUR_PX

  const visible = dayAppts
    .map(a => {
      const start = new Date(a.start_at)
      const end   = a.end_at ? new Date(a.end_at) : new Date(start.getTime() + 60 * 60_000)
      const startMin = (start.getHours() - DAY_START_H) * 60 + start.getMinutes()
      const endMin   = (end.getHours()   - DAY_START_H) * 60 + end.getMinutes()
      return { appt: a, start, startMin, endMin }
    })
    .filter(x => x.endMin > 0 && x.startMin < (DAY_END_H - DAY_START_H + 1) * 60)

  // Current-time red line (only for the day column that matches `now`)
  const showNow =
    sameDay(date, now) &&
    now.getHours() >= DAY_START_H &&
    now.getHours() <= DAY_END_H
  const nowMin = (now.getHours() - DAY_START_H) * 60 + now.getMinutes()
  const nowTop = (nowMin / 60) * HOUR_PX

  // Draft block for this day
  const dayDraft = draft && draft.dayKey === dateKey(date) ? draft : null

  return (
    <div className="flex-1 min-w-0 border-l border-pvx-border first:border-l-0">
      {/* Sticky header */}
      <div
        className={`sticky top-0 z-40 bg-pvx-surface px-2 py-2 text-center border-b border-pvx-border ${isToday ? 'text-violet-300' : 'text-gray-400'}`}
        style={{ height: `${HEADER_PX}px` }}
      >
        <div className="text-[10px] uppercase tracking-wider">{WD_SHORT[date.getDay()]}</div>
        <div className={`mx-auto mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm ${
          isToday ? 'bg-violet-600 text-white font-semibold' : ''
        }`}>
          {date.getDate()}
        </div>
      </div>

      {/* Time grid + absolute-positioned appointment blocks */}
      <div className="relative" style={{ height: `${gridPx}px` }}>
        {/* Clickable hour slots as background layer */}
        {DAY_HOURS.map((h, i) => {
          const slotDate = new Date(date); slotDate.setHours(h, 0, 0, 0)
          return (
            <button
              key={h}
              type="button"
              onClick={() => onSlotClick(slotDate)}
              className="absolute left-0 right-0 border-b border-pvx-border/60 hover:bg-violet-500/5 transition-colors"
              style={{ top: `${i * HOUR_PX}px`, height: `${HOUR_PX}px` }}
            />
          )
        })}

        {/* Appointment blocks — clickable to edit */}
        {visible.map(({ appt, start, startMin, endMin }) => {
          const top    = Math.max(0, (startMin / 60) * HOUR_PX)
          const bottom = Math.min(gridPx, (endMin / 60) * HOUR_PX)
          const height = Math.max(22, bottom - top - 2)
          return (
            <button
              key={appt.id}
              type="button"
              onClick={e => { e.stopPropagation(); onEditAppt(appt) }}
              className="absolute left-1 right-1 z-10 text-left rounded bg-violet-500/30 border border-violet-500/50 text-violet-100 px-1.5 py-0.5 overflow-hidden hover:bg-violet-500/40 hover:border-violet-400 transition-colors"
              style={{ top: `${top}px`, height: `${height}px` }}
            >
              <div className="text-[10px] font-medium truncate">{appt.title}</div>
              <div className="text-[9px] opacity-80 truncate">{fmtTime12(start)}</div>
            </button>
          )
        })}

        {/* Draft block */}
        {dayDraft && (
          <div
            className="absolute left-1 right-1 z-20 rounded border-2 border-dashed border-violet-400 bg-violet-500/10 text-violet-100 px-1.5 py-0.5 overflow-hidden pointer-events-none"
            style={{
              top:    `${(dayDraft.startMin / 60) * HOUR_PX}px`,
              height: `${Math.max(22, ((dayDraft.endMin - dayDraft.startMin) / 60) * HOUR_PX - 2)}px`,
            }}
          >
            <div className="text-[10px] font-medium truncate">Draft</div>
          </div>
        )}

        {/* Current time indicator */}
        {showNow && (
          <div
            className="absolute left-0 right-0 z-30 pointer-events-none"
            style={{ top: `${nowTop}px` }}
          >
            <div className="relative h-px bg-red-500">
              <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Day view ─────────────────────────────────────────────────────────────────

function DayView({ cursor, byDay, onSlotClick, onEditAppt, today, now, draft }: { cursor: Date; byDay: Map<string, CalAppt[]>; onSlotClick: (d: Date) => void; onEditAppt: (a: CalAppt) => void; today: Date; now: Date; draft: { dayKey: string; startMin: number; endMin: number } | null }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HOUR_PX, behavior: 'auto' })
  }, [])
  return (
    <div
      ref={scrollRef}
      className="border border-pvx-border rounded-lg overflow-y-auto"
      style={{ maxHeight: `${GRID_MAX_H}px` }}
    >
      <div className="flex min-w-full">
        <HourLegend />
        <HourColumn date={cursor} byDay={byDay} onSlotClick={onSlotClick} onEditAppt={onEditAppt} today={today} now={now} draft={draft} />
      </div>
    </div>
  )
}

// ── Week view ────────────────────────────────────────────────────────────────

function WeekView({ cursor, byDay, onSlotClick, onEditAppt, today, now, draft }: { cursor: Date; byDay: Map<string, CalAppt[]>; onSlotClick: (d: Date) => void; onEditAppt: (a: CalAppt) => void; today: Date; now: Date; draft: { dayKey: string; startMin: number; endMin: number } | null }) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: DEFAULT_SCROLL_HOUR * HOUR_PX, behavior: 'auto' })
  }, [])
  return (
    <div
      ref={scrollRef}
      className="border border-pvx-border rounded-lg overflow-y-auto"
      style={{ maxHeight: `${GRID_MAX_H}px` }}
    >
      <div className="flex min-w-full">
        <HourLegend />
        {days.map(d => (
          <HourColumn key={dateKey(d)} date={d} byDay={byDay} onSlotClick={onSlotClick} onEditAppt={onEditAppt} today={today} now={now} draft={draft} />
        ))}
      </div>
    </div>
  )
}

// ── Month view ───────────────────────────────────────────────────────────────

function MonthView({
  cursor, byDay, onCellClick, onEditAppt, onMorePill, today,
}: {
  cursor: Date
  byDay: Map<string, CalAppt[]>
  onCellClick: (d: Date) => void
  onEditAppt:  (a: CalAppt) => void
  onMorePill:  (d: Date, appts: CalAppt[]) => void
  today: Date
}) {
  const start = startOfWeek(startOfMonth(cursor))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {WD_SHORT.map(wd => (
          <div key={wd} className="text-[10px] uppercase tracking-wider text-gray-500 text-center py-2">
            {wd}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-pvx-border/60 border border-pvx-border rounded-lg overflow-hidden">
        {cells.map(d => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const isToday = sameDay(d, today)
          const appts = byDay.get(dateKey(d)) ?? []
          const visible = appts.slice(0, 2)
          const overflow = appts.length - visible.length
          return (
            <button
              key={dateKey(d)}
              type="button"
              onClick={() => {
                const s = new Date(d); s.setHours(9, 0, 0, 0)
                onCellClick(s)
              }}
              className={`min-h-[90px] text-left p-2 bg-pvx-surface transition-colors hover:bg-violet-500/5 ${inMonth ? '' : 'opacity-40'}`}
            >
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs mb-1 ${
                isToday ? 'bg-violet-600 text-white font-semibold' : 'text-gray-300'
              }`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {visible.map(a => (
                  <div
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); onEditAppt(a) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        onEditAppt(a)
                      }
                    }}
                    className="text-[10px] bg-violet-500/15 border border-violet-500/25 text-violet-100 rounded px-1 py-0.5 truncate cursor-pointer hover:bg-violet-500/30 hover:border-violet-400 transition-colors"
                  >
                    {a.title}
                  </div>
                ))}
                {overflow > 0 && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); onMorePill(d, appts) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        onMorePill(d, appts)
                      }
                    }}
                    className="text-[10px] text-gray-500 hover:text-violet-300 cursor-pointer transition-colors"
                  >
                    +{overflow} more
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Year view ────────────────────────────────────────────────────────────────

function YearView({ cursor, byDay, today, onMonthClick }: { cursor: Date; byDay: Map<string, CalAppt[]>; today: Date; onMonthClick: (m: number) => void }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {MONTH_NAMES.map((_, idx) => (
        <MiniMonth
          key={idx}
          year={cursor.getFullYear()}
          month={idx}
          byDay={byDay}
          today={today}
          onClick={() => onMonthClick(idx)}
        />
      ))}
    </div>
  )
}

function MiniMonth({ year, month, byDay, today, onClick }: { year: number; month: number; byDay: Map<string, CalAppt[]>; today: Date; onClick: () => void }) {
  const start = startOfWeek(new Date(year, month, 1))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        isCurrentMonth
          ? 'border-violet-500 shadow-[0_0_20px_rgba(139,92,246,0.25)]'
          : 'border-pvx-border hover:border-violet-500/40'
      }`}
    >
      <div className={`text-xs font-semibold mb-2 ${isCurrentMonth ? 'text-violet-200' : 'text-gray-200'}`}>{MONTH_FULL[month]}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {WD_SHORT.map(wd => (
          <div key={wd} className="text-[9px] text-center text-gray-600">{wd[0]}</div>
        ))}
        {cells.map(d => {
          const inMonth = d.getMonth() === month
          const isToday = sameDay(d, today)
          const hasAppts = (byDay.get(dateKey(d)) ?? []).length > 0
          return (
            <div
              key={dateKey(d)}
              className={`text-[9px] text-center py-0.5 rounded-sm ${
                !inMonth ? 'text-gray-700'
                  : isToday ? 'bg-violet-600 text-white font-semibold'
                  : hasAppts ? 'bg-violet-500/20 text-violet-200'
                  : 'text-gray-400'
              }`}
            >
              {d.getDate()}
            </div>
          )
        })}
      </div>
    </button>
  )
}

// ── Decade view ──────────────────────────────────────────────────────────────

function DecadeView({ cursor, byYear, today, onYearClick }: { cursor: Date; byYear: Map<number, number>; today: Date; onYearClick: (y: number) => void }) {
  const start = Math.floor(cursor.getFullYear() / 10) * 10
  const years = Array.from({ length: 10 }, (_, i) => start + i)
  const max = Math.max(1, ...Array.from(byYear.values()))

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {years.map(y => {
        const count = byYear.get(y) ?? 0
        const intensity = count / max
        const isCurrent = y === today.getFullYear()
        return (
          <button
            key={y}
            type="button"
            onClick={() => onYearClick(y)}
            className={`rounded-lg border p-4 text-left transition-colors ${
              isCurrent
                ? 'border-violet-500 shadow-[0_0_24px_rgba(139,92,246,0.35)]'
                : 'border-pvx-border hover:border-violet-500/40'
            }`}
            style={count > 0 ? { backgroundColor: `rgba(139, 92, 246, ${0.08 + intensity * 0.25})` } : undefined}
          >
            <div className={`text-lg font-semibold ${isCurrent ? 'text-violet-100' : 'text-white'}`}>{y}</div>
            <div className="text-xs text-gray-400 mt-1">
              {count} appointment{count === 1 ? '' : 's'}
            </div>
          </button>
        )
      })}
    </div>
  )
}
