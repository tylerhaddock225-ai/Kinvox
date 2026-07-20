'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { sendTicketMessage, draftTicketReply } from '@/app/(app)/(dashboard)/actions/tickets'

type MessageType = 'public' | 'internal'

// Maps the draftTicketReply error codes to user-facing copy. Anything not listed
// falls through to a generic message.
const DRAFT_ERROR_LABELS: Record<string, string> = {
  insufficient_credits: 'Out of AI credits',
  ai_support_disabled:  'AI support is off for this org',
  no_customer_message:  'No customer message to reply to',
}

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof sendTicketMessage>>, FormData>>[0]

export default function ReplyBox({ ticketId, initialDraft }: { ticketId: string; initialDraft?: string }) {
  const [type, setType] = useState<MessageType>('public')
  const [state, action, isPending] = useActionState(sendTicketMessage, INITIAL)
  const formRef     = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  // AD Stage 5 — marker shown when the composer was pre-filled from a stored
  // auto-draft. Cleared once the reply is sent.
  const [showDraftMarker, setShowDraftMarker] = useState(Boolean(initialDraft))

  useEffect(() => {
    if (state?.status !== 'success') return
    formRef.current?.reset()
    setShowDraftMarker(false)
    // Hold focus on the reply area so the page never jumps after revalidation.
    const ta = textareaRef.current
    if (ta) {
      // reset() restores the textarea to its defaultValue (the pre-filled
      // draft); clear it explicitly so a sent reply doesn't repopulate.
      ta.value = ''
      ta.focus({ preventScroll: true })
      ta.scrollIntoView({ block: 'nearest' })
    }
  }, [state])

  const isInternal = type === 'internal'

  // Draft with AI: calls the standalone draft action (NOT the send action) and
  // fills the composer with the returned text for the human to review/edit/send.
  // Never auto-sends.
  async function handleDraft() {
    setDraftError(null)
    setIsDrafting(true)
    try {
      const res = await draftTicketReply(ticketId)
      if (res.ok) {
        setType('public') // a drafted customer reply is a public reply
        const ta = textareaRef.current
        if (ta) {
          ta.value = res.text
          ta.focus({ preventScroll: true })
        }
      } else {
        setDraftError(DRAFT_ERROR_LABELS[res.error] ?? 'Could not draft a reply. Try again.')
      }
    } catch {
      setDraftError('Could not draft a reply. Try again.')
    } finally {
      setIsDrafting(false)
    }
  }

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="type" value={type} />

      <div className="flex items-center justify-between gap-3">
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

        <button
          type="button"
          onClick={handleDraft}
          disabled={isDrafting || isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {isDrafting ? 'Drafting…' : 'Draft with AI'}
        </button>
      </div>

      {draftError && (
        <p className="text-xs text-amber-400">{draftError}</p>
      )}

      {showDraftMarker && !isInternal && (
        <div className="flex items-center gap-1.5 text-xs text-violet-300">
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI draft ready — review and edit before sending</span>
        </div>
      )}

      <textarea
        ref={textareaRef}
        name="body"
        required
        rows={4}
        defaultValue={initialDraft}
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
