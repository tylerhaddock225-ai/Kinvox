'use client'

import { useEffect, useRef, useState, useActionState } from 'react'
import { AlertTriangle, Sparkles, MessageSquare, Mail } from 'lucide-react'
import { sendTicketMessage, draftTicketReply } from '@/app/(app)/(dashboard)/actions/tickets'

type MessageType = 'public' | 'internal'
type Channel     = 'email' | 'sms'

// Maps the draftTicketReply error codes to user-facing copy. Anything not listed
// falls through to a generic message.
const DRAFT_ERROR_LABELS: Record<string, string> = {
  insufficient_credits: 'Out of AI credits',
  ai_support_disabled:  'AI support is off for this org',
  no_customer_message:  'No customer message to reply to',
}

// Maps the sendTicketMessage typed error codes (SMS-1) to user-facing copy.
// Unknown values (e.g. a raw DB message) render as-is.
const SEND_ERROR_LABELS: Record<string, string> = {
  no_recipient_phone: 'This customer has no phone number on file — add one to send by SMS.',
  sms_send_failed:    'Message saved, but the SMS could not be delivered. Try again.',
}

// SMS segment boundary for the char-count warning: >2 segments (>320 chars).
const SMS_SEGMENT_WARN = 320

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof sendTicketMessage>>, FormData>>[0]

export default function ReplyBox({
  ticketId,
  initialDraft,
  smsSupportNumber,
  smsRecipientDisplay,
}: {
  ticketId: string
  initialDraft?: string
  // SMS-1 (both optional so non-SMS callers — e.g. hq-support — keep working).
  smsSupportNumber?: string | null    // org's support sending number, or null
  smsRecipientDisplay?: string | null // recipient phone, pretty-formatted, or null
}) {
  const [type, setType] = useState<MessageType>('public')
  const [channel, setChannel] = useState<Channel>('email')
  const [state, action, isPending] = useActionState(sendTicketMessage, INITIAL)
  const formRef     = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [charCount, setCharCount] = useState(initialDraft?.length ?? 0)
  // AD Stage 5 — marker shown when the composer was pre-filled from a stored
  // auto-draft. Cleared once the reply is sent.
  const [showDraftMarker, setShowDraftMarker] = useState(Boolean(initialDraft))

  // SMS is offered only when the org has a sending number AND the ticket's
  // customer has a usable phone. Otherwise the option is disabled with a reason.
  const smsReady = Boolean(smsSupportNumber) && Boolean(smsRecipientDisplay)
  const smsDisabledReason = !smsSupportNumber
    ? 'This organization has no SMS number configured.'
    : 'This customer has no phone number on file.'

  useEffect(() => {
    if (state?.status !== 'success') return
    formRef.current?.reset()
    setShowDraftMarker(false)
    setCharCount(0)
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
          setCharCount(res.text.length)
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

  const segClass = (active: boolean, disabled = false) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
      disabled
        ? 'text-gray-600 cursor-not-allowed'
        : active
          ? 'bg-violet-600 text-white'
          : 'text-gray-400 hover:text-white'
    }`

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <input type="hidden" name="type" value={type} />
      {/* Only public replies are sent; internal notes force email so nothing sends. */}
      <input type="hidden" name="channel" value={isInternal ? 'email' : channel} />

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

      {/* SMS-1 — channel toggle. Public replies only (internal notes never send). */}
      {!isInternal && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg border border-pvx-border bg-pvx-surface p-1 w-fit">
            <button type="button" onClick={() => setChannel('email')} className={segClass(channel === 'email')}>
              <Mail className="w-3.5 h-3.5" />
              Email
            </button>
            <button
              type="button"
              onClick={() => { if (smsReady) setChannel('sms') }}
              disabled={!smsReady}
              title={smsReady ? undefined : smsDisabledReason}
              className={segClass(channel === 'sms', !smsReady)}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              SMS
            </button>
          </div>

          {channel === 'sms' && smsRecipientDisplay && (
            <span className="text-xs text-gray-500">
              To {smsRecipientDisplay}
              {' · '}
              <span className={charCount > SMS_SEGMENT_WARN ? 'text-amber-400' : 'text-gray-500'}>
                {charCount} char{charCount === 1 ? '' : 's'}
              </span>
            </span>
          )}
        </div>
      )}

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
        onChange={(e) => setCharCount(e.target.value.length)}
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
        <p className="text-xs text-red-400">{SEND_ERROR_LABELS[state.error] ?? state.error}</p>
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
            : isInternal
              ? 'Add Internal Note'
              : channel === 'sms' ? 'Send SMS' : 'Send Reply'}
        </button>
      </div>
    </form>
  )
}
