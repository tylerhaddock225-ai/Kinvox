'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { sendTicketMessage } from '@/app/(dashboard)/actions/tickets'

type MessageType = 'public' | 'internal'

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof sendTicketMessage>>, FormData>>[0]

export default function ReplyBox({ ticketId }: { ticketId: string }) {
  const [type, setType] = useState<MessageType>('public')
  const [state, action, isPending] = useActionState(sendTicketMessage, INITIAL)
  const formRef     = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (state?.status !== 'success') return
    formRef.current?.reset()
    // Hold focus on the reply area so the page never jumps after revalidation.
    const ta = textareaRef.current
    if (ta) {
      ta.focus({ preventScroll: true })
      ta.scrollIntoView({ block: 'nearest' })
    }
  }, [state])

  const isInternal = type === 'internal'

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="type" value={type} />

      <div className="flex items-center gap-1 rounded-lg border border-pvx-border bg-pvx-surface p-1 w-fit">
        <button
          type="button"
          onClick={() => setType('public')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            type === 'public'
              ? 'bg-violet-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Public Reply
        </button>
        <button
          type="button"
          onClick={() => setType('internal')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            type === 'internal'
              ? 'bg-yellow-500 text-gray-900'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Internal Note
        </button>
      </div>

      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={4}
        placeholder={isInternal ? 'Write a private note for your team…' : 'Write a reply to the customer…'}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 resize-none transition-colors ${
          isInternal
            ? 'border-yellow-500/40 bg-yellow-500/5 focus:ring-yellow-500'
            : 'border-pvx-border bg-gray-900 focus:ring-violet-500'
        }`}
      />

      {isInternal && (
        <div className="flex items-center gap-2 text-xs text-yellow-300">
          <AlertTriangle className="w-4 h-4" />
          <span>Customer will not see this.</span>
        </div>
      )}

      {state?.status === 'error' && (
        <p className="text-xs text-red-400">{state.error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
            isInternal
              ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-400'
              : 'bg-violet-600 text-white hover:bg-violet-500'
          }`}
        >
          {isPending
            ? 'Sending…'
            : isInternal ? 'Add Internal Note' : 'Send Reply'}
        </button>
      </div>
    </form>
  )
}
