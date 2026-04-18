'use client'

import { useEffect, useRef, useActionState } from 'react'
import { Plus, X } from 'lucide-react'
import { createTicket } from '@/app/(dashboard)/actions/tickets'

type Member = { id: string; full_name: string | null }
type Lead   = { id: string; first_name: string; last_name: string | null }

interface Props {
  members: Member[]
  leads:   Lead[]
}

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof createTicket>>, FormData>>[0]

export default function CreateTicketModal({ members, leads }: Props) {
  const [state, action, isPending] = useActionState(createTicket, INITIAL)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
    }
  }, [state])

  function open() {
    formRef.current?.reset()
    dialogRef.current?.showModal()
  }

  return (
    <>
      <button
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Ticket
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-lg rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Create Ticket</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject *</label>
            <input
              name="subject"
              required
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="Ticket subject"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              name="description"
              rows={3}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              placeholder="Describe the issue…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority</label>
              <select name="priority" defaultValue="medium" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Status</label>
              <select name="status" defaultValue="open" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Channel</label>
              <select name="channel" defaultValue="" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="">— None —</option>
                <option value="email">Email</option>
                <option value="chat">Chat</option>
                <option value="phone">Phone</option>
                <option value="portal">Portal</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Assigned To</label>
              <select name="assigned_to" defaultValue="" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="">— Unassigned —</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name ?? 'Unknown'}</option>
                ))}
              </select>
            </div>
          </div>

          {leads.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Related Lead</label>
              <select name="lead_id" defaultValue="" className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                <option value="">— None —</option>
                {leads.map(l => (
                  <option key={l.id} value={l.id}>{l.first_name} {l.last_name ?? ''}</option>
                ))}
              </select>
            </div>
          )}

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
              {isPending ? 'Creating…' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
