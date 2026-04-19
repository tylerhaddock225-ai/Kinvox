'use client'

import { useEffect, useRef, useActionState } from 'react'
import { LifeBuoy, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createHQSupportTicket } from '@/app/(dashboard)/actions/tickets'

const INITIAL = null as ReturnType<typeof useActionState<Awaited<ReturnType<typeof createHQSupportTicket>>, FormData>>[0]

const CATEGORIES = [
  { value: 'bug',              label: 'Bug' },
  { value: 'billing',          label: 'Billing' },
  { value: 'feature_request',  label: 'Feature Request' },
  { value: 'question',         label: 'Question' },
] as const

// Must track tickets_affected_tab_check in 20260419222000_hq_form_toggles.sql.
const AFFECTED_TABS = [
  { value: 'dashboard',    label: 'Dashboard' },
  { value: 'leads',        label: 'Leads' },
  { value: 'customers',    label: 'Customers' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'tickets',      label: 'Tickets' },
  { value: 'settings',     label: 'Settings' },
] as const

interface Props {
  showAffectedTab?: boolean
  showRecordId?:    boolean
}

export default function HQSupportModal({ showAffectedTab = false, showRecordId = false }: Props) {
  const router = useRouter()
  const [state, action, isPending] = useActionState(createHQSupportTicket, INITIAL)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
      // Refresh the server component so the new row appears on /support
      // immediately. revalidatePath in the action covers cold reloads.
      router.refresh()
    }
  }, [state, router])

  function open() {
    formRef.current?.reset()
    dialogRef.current?.showModal()
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New HQ Request
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-lg rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-violet-400" />
            Contact Kinvox HQ Support
          </h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-5">
          {'This goes straight to the Kinvox team \u2014 not your organization\u2019s customers.'}
        </p>

        <form ref={formRef} action={action} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject *</label>
            <input
              name="subject"
              required
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="One-line summary"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Category *</label>
            <select
              name="hq_category"
              required
              defaultValue=""
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              <option value="" disabled>— Select a category —</option>
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              name="description"
              rows={5}
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              placeholder="Steps to reproduce, context, what you expected…"
            />
          </div>

          {showAffectedTab && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Affected Tab (optional)</label>
              <select
                name="affected_tab"
                defaultValue=""
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="">\u2014 None \u2014</option>
                {AFFECTED_TABS.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          {showRecordId && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Record ID (optional)</label>
              <input
                name="record_id"
                type="text"
                className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono"
                placeholder="e.g. ld_123"
                maxLength={64}
              />
              <p className="text-[10px] text-gray-500 mt-1">Paste the ID of the specific record this is about.</p>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Screenshot URL (optional)</label>
            <input
              name="screenshot_url"
              type="url"
              className="w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              placeholder="https://\u2026"
            />
            <p className="text-[10px] text-gray-500 mt-1">Paste a link from your clipboard or a shared drive.</p>
          </div>

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
              {isPending ? 'Sending…' : 'Send to HQ'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
