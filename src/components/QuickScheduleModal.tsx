'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { CalendarPlus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createAppointment } from '@/app/(dashboard)/actions/appointments'

interface Props {
  leadId?:     string
  customerId?: string
}

const DURATIONS = [15, 30, 45, 60, 90, 120] as const
const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof createAppointment>>, FormData>>[0]

// Combine date + time into the datetime-local string shape the server action
// already accepts, so downstream email/ICS formatting stays identical to the
// full CreateAppointmentModal flow.
function combine(date: string, time: string): string {
  return date && time ? `${date}T${time}` : ''
}

function addMinutes(dtLocal: string, mins: number): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return ''
  d.setMinutes(d.getMinutes() + mins)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  if (mins === 60) return '1 hour'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h} hours`
}

export default function QuickScheduleModal({ leadId, customerId }: Props) {
  const router = useRouter()
  const [state, action, isPending] = useActionState(createAppointment, INITIAL)
  const [date,     setDate]     = useState('')
  const [time,     setTime]     = useState('')
  const [duration, setDuration] = useState<number>(30)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
      setDate('')
      setTime('')
      setDuration(30)
      // Re-run the current server component so the related-records section
      // reflects the new appointment without a manual reload.
      router.refresh()
    }
  }, [state, router])

  function open() {
    formRef.current?.reset()
    setDate('')
    setTime('')
    setDuration(30)
    dialogRef.current?.showModal()
  }

  const start = combine(date, time)
  const end   = start ? addMinutes(start, duration) : ''

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600/10 px-3 py-1.5 text-sm font-medium text-violet-400 hover:bg-violet-600/20 transition-colors shrink-0"
      >
        <CalendarPlus className="w-4 h-4" />
        Schedule Appointment
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Schedule Appointment</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4">
          {leadId     && <input type="hidden" name="lead_id"     value={leadId} />}
          {customerId && <input type="hidden" name="customer_id" value={customerId} />}
          <input type="hidden" name="start_at" value={start} />
          <input type="hidden" name="end_at"   value={end} />

          <div>
            <label className="block text-xs text-gray-400 mb-1">Title *</label>
            <input
              name="title"
              required
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="Discovery call"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Date *</label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Time *</label>
              <input
                type="time"
                required
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Duration</label>
            <select
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {DURATIONS.map(d => (
                <option key={d} value={d}>{formatDuration(d)}</option>
              ))}
            </select>
          </div>

          {state?.status === 'error' && (
            <p className="text-xs text-red-400">{state.error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => dialogRef.current?.close()} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Scheduling…' : 'Schedule'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
