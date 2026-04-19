'use client'

import { useActionState, useEffect, useState } from 'react'
import { CheckCircle2, Hash } from 'lucide-react'
import { updateTicketIdPrefix } from '@/app/(admin)/admin-hq/actions/platform-settings'

const INPUT = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500'
const LABEL = 'block text-xs font-medium text-gray-400 mb-1'
const BTN   = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY = `${BTN} bg-violet-600 text-white hover:bg-violet-500`

const TABS = [
  { id: 'support', label: 'Support Settings' },
] as const

type TabId = typeof TABS[number]['id']

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-2xl">
      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
      <span>{message}</span>
    </div>
  )
}

function SupportSettingsPanel({ currentPrefix }: { currentPrefix: string }) {
  const [state, action, pending] = useActionState(updateTicketIdPrefix, null)
  const [toast, setToast] = useState<string | null>(null)
  const [preview, setPreview] = useState<string>(currentPrefix)

  useEffect(() => {
    if (state?.status === 'success' && state.message) setToast(state.message)
  }, [state])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-5">
        <div className="flex items-start gap-3">
          <Hash className="w-4 h-4 text-violet-400 mt-1 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-white">Ticket ID Format</h3>
            <p className="text-xs text-gray-500 mt-1">
              Controls the prefix on auto-generated ticket display IDs (e.g. <code className="text-gray-400">tk_123</code>,{' '}
              <code className="text-gray-400">REQ-123</code>). Existing ticket IDs don\u2019t change \u2014 only new tickets adopt the new prefix.
            </p>
          </div>
        </div>

        <form action={action} className="space-y-4">
          <div>
            <label className={LABEL} htmlFor="prefix">Prefix</label>
            <div className="flex gap-2">
              <input
                id="prefix"
                name="ticket_id_prefix"
                type="text"
                required
                defaultValue={currentPrefix}
                onChange={e => setPreview(e.target.value)}
                maxLength={12}
                placeholder="tk_"
                className={INPUT + ' max-w-xs font-mono'}
              />
              <button type="submit" disabled={pending} className={BTN_PRIMARY + ' shrink-0'}>
                {pending ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Preview: <code className="text-violet-300">{(preview || 'tk_') + '123'}</code>
            </p>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}
        </form>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

export default function SettingsTabs({ currentPrefix }: { currentPrefix: string }) {
  const [activeTab, setActiveTab] = useState<TabId>('support')

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-pvx-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-violet-500 text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'support' && <SupportSettingsPanel currentPrefix={currentPrefix} />}
    </div>
  )
}
