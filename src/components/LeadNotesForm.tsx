'use client'

import { useActionState, useEffect, useRef } from 'react'
import { addLeadNote, type AddNoteState } from '@/app/(app)/(dashboard)/actions/leads'

interface Props {
  leadId: string
}

export default function LeadNotesForm({ leadId }: Props) {
  const bound = addLeadNote.bind(null, leadId)
  const [state, action, pending] = useActionState<AddNoteState, FormData>(bound, null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <textarea
        name="content"
        rows={3}
        required
        placeholder="Add a note about this lead…"
        className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
      />

      {state?.status === 'error' && (
        <p className="text-xs text-red-400">{state.error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Saving…' : 'Add Note'}
        </button>
      </div>
    </form>
  )
}
