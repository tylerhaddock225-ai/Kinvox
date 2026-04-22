'use client'

import { useEffect, useImperativeHandle, useRef, useState, useActionState, type Ref } from 'react'
import { Plus, X } from 'lucide-react'
import { createAppointment } from '@/app/(app)/(dashboard)/actions/appointments'

type Member   = { id: string; full_name: string | null }
type Customer = { id: string; first_name: string; last_name: string | null; email: string | null }

export type CreateAppointmentModalHandle = {
  openWithStart: (iso: string) => void
}

interface Props {
  members:      Member[]
  customers:    Customer[]
  hideTrigger?: boolean
  onClose?:     () => void
  ref?:         Ref<CreateAppointmentModalHandle>
}

function customerLabel(c: Customer): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
  if (c.email && name) return `${name} — ${c.email}`
  return name || c.email || 'Unknown'
}

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof createAppointment>>, FormData>>[0]

function addMinutesToLocal(dtLocal: string, mins: number): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return ''
  d.setMinutes(d.getMinutes() + mins)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function CreateAppointmentModal({ members, customers, hideTrigger, onClose, ref }: Props) {
  const [state, action, isPending] = useActionState(createAppointment, INITIAL)
  const [startVal, setStartVal] = useState<string>('')
  const [endVal,   setEndVal]   = useState<string>('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
      setStartVal('')
      setEndVal('')
    }
  }, [state])

  useImperativeHandle(ref, () => ({
    openWithStart(iso: string) {
      setStartVal(iso)
      setEndVal(addMinutesToLocal(iso, 30))
      dialogRef.current?.showModal()
    },
  }), [])

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg || !onClose) return
    dlg.addEventListener('close', onClose)
    return () => dlg.removeEventListener('close', onClose)
  }, [onClose])

  function open() {
    setStartVal('')
    setEndVal('')
    formRef.current?.reset()
    dialogRef.current?.showModal()
  }

  return (
    <>
      {!hideTrigger && (
      <button
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Appointment
      </button>
      )}

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-lg rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Create Appointment</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title *</label>
            <input
              name="title"
              required
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="Appointment title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Start *</label>
              <input
                name="start_at"
                type="datetime-local"
                required
                value={startVal}
                onChange={e => {
                  const v = e.target.value
                  setStartVal(v)
                  if (v) setEndVal(addMinutesToLocal(v, 30))
                }}
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">End</label>
              <input
                name="end_at"
                type="datetime-local"
                value={endVal}
                onChange={e => setEndVal(e.target.value)}
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Location</label>
            <input
              name="location"
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="Office, Zoom, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Meeting With (target user)</label>
              <select name="assigned_to" defaultValue="" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="">— Unassigned —</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name ?? 'Unknown'}</option>
                ))}
              </select>
              <p className="text-[10px] text-gray-500 mt-1">
                Invite goes to this user&rsquo;s calendar. You&rsquo;ll get a confirmation copy.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Customer</label>
              <select name="customer_id" defaultValue="" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="">— None —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{customerLabel(c)}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              name="description"
              rows={3}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              placeholder="Notes or agenda…"
            />
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
              {isPending ? 'Creating…' : 'Create Appointment'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
