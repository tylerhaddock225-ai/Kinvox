'use client'

import { useActionState, useEffect, useRef } from 'react'
import { X, Plus } from 'lucide-react'
import { createLead } from '@/app/(app)/(dashboard)/actions/leads'

const INPUT = 'w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500'
const LABEL = 'block text-xs font-medium text-gray-400 mb-1'

export default function CreateLeadModal() {
  const [state, action, pending] = useActionState(createLead, null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

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

  function close() {
    dialogRef.current?.close()
  }

  return (
    <>
      <button
        onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        New Lead
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">New Lead</h2>
          <button
            type="button"
            onClick={close}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={action} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="first_name">
                First Name <span className="text-red-400">*</span>
              </label>
              <input id="first_name" name="first_name" type="text" required placeholder="Jane" className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="last_name">Last Name</label>
              <input id="last_name" name="last_name" type="text" placeholder="Smith" className={INPUT} />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="company">Company</label>
            <input id="company" name="company" type="text" placeholder="Acme Corp" className={INPUT} />
          </div>

          <div>
            <label className={LABEL} htmlFor="email">Email</label>
            <input id="email" name="email" type="email" placeholder="jane@example.com" className={INPUT} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="source">Source</label>
              <select id="source" name="source" className={INPUT}>
                <option value="">— Select —</option>
                <option value="web">Web</option>
                <option value="referral">Referral</option>
                <option value="import">Import</option>
                <option value="manual">Manual</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="status">Status</label>
              <select id="status" name="status" className={INPUT}>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="lost">Lost</option>
                <option value="converted">Converted</option>
              </select>
            </div>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? 'Saving…' : 'Save Lead'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
