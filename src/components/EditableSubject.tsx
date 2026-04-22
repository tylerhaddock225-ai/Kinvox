'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { Pencil } from 'lucide-react'
import { updateTicketSubject } from '@/app/(app)/(dashboard)/actions/tickets'

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof updateTicketSubject>>, FormData>>[0]

export default function EditableSubject({ ticketId, initial }: { ticketId: string; initial: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(initial)
  const [state, action, isPending] = useActionState(updateTicketSubject, INITIAL)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(initial) }, [initial])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (state?.status === 'success') setEditing(false)
  }, [state])

  function cancel() {
    setValue(initial)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group inline-flex items-start gap-2 text-left"
        title="Click to edit subject"
      >
        <h1 className="text-2xl font-bold text-white leading-tight">{initial}</h1>
        <Pencil className="w-4 h-4 mt-1.5 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    )
  }

  return (
    <form action={action} className="flex-1">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          name="subject"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') cancel() }}
          required
          className="flex-1 rounded-lg border border-violet-500/50 bg-gray-900 px-3 py-1.5 text-2xl font-bold text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="submit"
          disabled={isPending || !value.trim() || value === initial}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
      {state?.status === 'error' && (
        <p className="mt-1 text-xs text-red-400">{state.error}</p>
      )}
    </form>
  )
}
