'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import {
  addTicketRecipient,
  removeTicketRecipient,
} from '@/app/(app)/(dashboard)/actions/ticket-recipients'

export type RecipientRow = {
  id:           string
  kind:         'to' | 'cc'
  user_id:      string | null
  email:        string | null
  display_name: string | null
}

interface Props {
  ticketId:   string
  recipients: RecipientRow[]
  mode:       'org' | 'hq'
}

function recipientLabel(r: RecipientRow): string {
  if (r.user_id) return r.display_name ?? '(unknown user)'
  return r.email ?? '(unknown)'
}

function RecipientChip({
  row,
  onRemove,
  disabled,
}: {
  row:      RecipientRow
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-pvx-border bg-gray-900 px-2.5 py-1 text-xs text-gray-200">
      <span className="truncate max-w-[20rem]">{recipientLabel(row)}</span>
      <button
        type="button"
        aria-label="Remove recipient"
        onClick={onRemove}
        disabled={disabled}
        className="text-gray-500 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}

function RecipientList({
  ticketId,
  kind,
  rows,
  mode,
}: {
  ticketId: string
  kind:     'to' | 'cc'
  rows:     RecipientRow[]
  mode:     'org' | 'hq'
}) {
  const [emailVal, setEmailVal] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleAdd() {
    setError(null)
    const value = emailVal.trim()
    if (!value) return
    startTransition(async () => {
      const res = await addTicketRecipient(ticketId, kind, { mode: 'email', email: value })
      if (res.status === 'success') {
        setEmailVal('')
      } else {
        setError(res.error)
      }
    })
  }

  function handleRemove(id: string) {
    setError(null)
    startTransition(async () => {
      const res = await removeTicketRecipient(id)
      if (res.status !== 'success') setError(res.error)
    })
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        {kind === 'to' ? 'To' : 'Cc'}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rows.map(r => (
            <RecipientChip
              key={r.id}
              row={r}
              disabled={isPending}
              onRemove={() => handleRemove(r.id)}
            />
          ))}
        </div>
      )}

      {mode === 'org' ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={emailVal}
              onChange={e => setEmailVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAdd()
                }
              }}
              disabled={isPending}
              placeholder="email@example.com"
              className="flex-1 rounded-lg border border-pvx-border bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending || emailVal.trim().length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Adding…' : 'Add'}
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-500 italic">HQ picker coming in Stage 3</p>
      )}
    </div>
  )
}

export default function TicketRecipientsSection({ ticketId, recipients, mode }: Props) {
  const toRows = recipients.filter(r => r.kind === 'to')
  const ccRows = recipients.filter(r => r.kind === 'cc')

  return (
    <section className="rounded-xl border border-pvx-border bg-pvx-surface/50 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300">Recipients</h2>
      <RecipientList ticketId={ticketId} kind="to" rows={toRows} mode={mode} />
      <RecipientList ticketId={ticketId} kind="cc" rows={ccRows} mode={mode} />
    </section>
  )
}
