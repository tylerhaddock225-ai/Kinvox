'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useActionState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import {
  postLeadInternalNote,
  postLeadPublicReply,
  type LeadMessageState,
} from '@/app/(app)/(dashboard)/actions/leads'
import ConversationThread, {
  type ConversationMessage,
} from '@/components/conversation/ConversationThread'

type Mode = 'public' | 'internal'

type Props = {
  leadId:   string
  orgSlug:  string                 // for the "verify your lead notifications email" deep-link
  messages: ConversationMessage[]
}

export default function LeadConversationPanel({ leadId, orgSlug, messages }: Props) {
  const [mode, setMode] = useState<Mode>('public')

  // Two server actions, two action handles. Switching tabs only flips
  // which action the form invokes — the textarea state survives the flip.
  const publicBound   = postLeadPublicReply.bind(null, leadId)
  const internalBound = postLeadInternalNote.bind(null, leadId)
  const [publicState,   publicAction,   publicPending]   = useActionState<LeadMessageState, FormData>(publicBound,   null)
  const [internalState, internalAction, internalPending] = useActionState<LeadMessageState, FormData>(internalBound, null)

  const formRef     = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset textarea + keep focus after a successful send/note. Mirrors the
  // ReplyBox pattern from Tickets so the UX feels identical.
  useEffect(() => {
    const last = mode === 'public' ? publicState : internalState
    if (last?.status !== 'success') return
    formRef.current?.reset()
    const ta = textareaRef.current
    if (ta) {
      ta.focus({ preventScroll: true })
      ta.scrollIntoView({ block: 'nearest' })
    }
  }, [mode, publicState, internalState])

  const isInternal = mode === 'internal'
  const action     = isInternal ? internalAction : publicAction
  const pending    = isInternal ? internalPending : publicPending
  const state      = isInternal ? internalState   : publicState

  return (
    <div className="space-y-4">
      <ConversationThread
        messages={messages}
        emptyHint="No messages yet. Reply to the lead or add a note below."
      />

      <section className="rounded-xl border border-pvx-border bg-pvx-surface p-4">
        <form ref={formRef} action={action} className="space-y-3">
          <div className="flex items-center gap-1 rounded-lg border border-pvx-border bg-pvx-surface p-1 w-fit">
            <button
              type="button"
              onClick={() => setMode('public')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'public'
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Public Reply
            </button>
            <button
              type="button"
              onClick={() => setMode('internal')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'internal'
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
            placeholder={isInternal ? 'Write a private note for your team…' : 'Write a reply to the lead…'}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 resize-none transition-colors ${
              isInternal
                ? 'border-yellow-500/40 bg-yellow-500/5 focus:ring-yellow-500'
                : 'border-pvx-border bg-gray-900 focus:ring-violet-500'
            }`}
          />

          {isInternal && (
            <div className="flex items-center gap-2 text-xs text-yellow-300">
              <AlertTriangle className="w-4 h-4" />
              <span>Lead will not see this.</span>
            </div>
          )}

          {state?.status === 'error' && (
            <div className="text-xs text-red-400 space-y-1">
              <p>{state.error}</p>
              {state.needs_lead_email_verification && (
                <Link
                  href={`/${orgSlug}/settings/team?tab=lead-support`}
                  className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 transition-colors"
                >
                  Open Lead Support settings
                  <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={pending}
              className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                isInternal
                  ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-400'
                  : 'bg-violet-600 text-white hover:bg-violet-500'
              }`}
            >
              {pending
                ? 'Sending…'
                : isInternal ? 'Add Note' : 'Send Reply'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
