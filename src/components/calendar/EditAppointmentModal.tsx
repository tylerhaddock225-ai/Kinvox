'use client'

import {
  useActionState,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
  type Ref,
} from 'react'
import { Trash2, X } from 'lucide-react'
import {
  deleteAppointment,
  updateAppointment,
  type State,
} from '@/app/(dashboard)/actions/appointments'
import CopyId from '@/components/CopyId'
import type { CalAppt } from './CalendarCore'

type Member = { id: string; full_name: string | null }
type Lead   = { id: string; first_name: string; last_name: string | null }

export type EditAppointmentModalHandle = {
  openWithAppointment: (appt: CalAppt) => void
}

interface Props {
  members:  Member[]
  leads:    Lead[]
  onClose?: () => void
  ref?:     Ref<EditAppointmentModalHandle>
}

function isoToDtLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function addMinutesToLocal(dtLocal: string, mins: number): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return ''
  d.setMinutes(d.getMinutes() + mins)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function EditAppointmentModal({ members, leads, onClose, ref }: Props) {
  const [appt, setAppt] = useState<CalAppt | null>(null)

  // Bind the action to the current appointment id.
  const boundAction = async (_prev: State, formData: FormData): Promise<State> => {
    if (!appt) return { status: 'error', error: 'Missing appointment' }
    return updateAppointment(appt.id, _prev, formData)
  }
  const [state, action, isPending] = useActionState<State, FormData>(boundAction, null)

  const [titleVal,   setTitleVal]   = useState('')
  const [startVal,   setStartVal]   = useState('')
  const [endVal,     setEndVal]     = useState('')
  const [locVal,     setLocVal]     = useState('')
  const [descVal,    setDescVal]    = useState('')
  const [assignVal,  setAssignVal]  = useState('')
  const [leadVal,    setLeadVal]    = useState('')

  const [deletePending, startDelete] = useTransition()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (state?.status === 'success') dialogRef.current?.close()
  }, [state])

  function handleDelete() {
    if (!appt) return
    const ok = window.confirm('Delete this appointment? This cannot be undone.')
    if (!ok) return
    startDelete(async () => {
      await deleteAppointment(appt.id)
      dialogRef.current?.close()
    })
  }

  useEffect(() => {
    const dlg = dialogRef.current
    if (!dlg || !onClose) return
    dlg.addEventListener('close', onClose)
    return () => dlg.removeEventListener('close', onClose)
  }, [onClose])

  useImperativeHandle(ref, () => ({
    openWithAppointment(a: CalAppt) {
      setAppt(a)
      setTitleVal(a.title)
      setStartVal(isoToDtLocal(a.start_at))
      setEndVal(a.end_at ? isoToDtLocal(a.end_at) : '')
      setLocVal(a.location ?? '')
      setDescVal(a.description ?? '')
      setAssignVal(a.assigned_to ?? '')
      setLeadVal(a.lead_id ?? '')
      dialogRef.current?.showModal()
    },
  }), [])

  return (
    <dialog
      ref={dialogRef}
      className="m-auto w-full max-w-lg rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold">Edit Appointment</h2>
          {appt?.display_id && (
            <div className="mt-0.5 text-xs">
              <CopyId id={appt.display_id} />
            </div>
          )}
        </div>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Title *</label>
          <input
            name="title"
            required
            value={titleVal}
            onChange={e => setTitleVal(e.target.value)}
            className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
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
            value={locVal}
            onChange={e => setLocVal(e.target.value)}
            className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            placeholder="Office, Zoom, etc."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Meeting With (target user)</label>
            <select
              name="assigned_to"
              value={assignVal}
              onChange={e => setAssignVal(e.target.value)}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="">— Unassigned —</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.full_name ?? 'Unknown'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Related Lead</label>
            <select
              name="lead_id"
              value={leadVal}
              onChange={e => setLeadVal(e.target.value)}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="">— None —</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>{l.first_name} {l.last_name ?? ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Description</label>
          <textarea
            name="description"
            rows={3}
            value={descVal}
            onChange={e => setDescVal(e.target.value)}
            className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
          />
        </div>

        {state?.status === 'error' && (
          <p className="text-xs text-red-400">{state.error}</p>
        )}

        <div className="flex justify-between items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePending}
            className="inline-flex items-center gap-1.5 text-red-500 hover:bg-red-500/10 px-3 py-2 rounded-md transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            {deletePending ? 'Deleting…' : 'Delete'}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={() => dialogRef.current?.close()} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  )
}
