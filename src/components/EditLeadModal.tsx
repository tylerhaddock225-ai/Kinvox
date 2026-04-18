'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Pencil, X } from 'lucide-react'
import { updateLead, type UpdateLeadState } from '@/app/(dashboard)/actions/leads'
import type { Lead } from '@/lib/types/database.types'

const INPUT = 'w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500'
const LABEL = 'block text-xs font-medium text-gray-400 mb-1'

type LeadFields = Pick<Lead, 'id' | 'first_name' | 'last_name' | 'company' | 'email' | 'phone' | 'source'>

interface Props {
  lead: LeadFields
}

export default function EditLeadModal({ lead }: Props) {
  const bound = updateLead.bind(null, lead.id)
  const [state, action, pending] = useActionState<UpdateLeadState, FormData>(bound, null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (state?.status === 'success') dialogRef.current?.close()
  }, [state])

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        title="Edit details"
        aria-label="Edit details"
        className="p-1 text-gray-500 hover:text-violet-400 transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Edit Lead</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form action={action} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="edit_first_name">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                id="edit_first_name"
                name="first_name"
                type="text"
                required
                defaultValue={lead.first_name}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="edit_last_name">Last Name</label>
              <input
                id="edit_last_name"
                name="last_name"
                type="text"
                defaultValue={lead.last_name ?? ''}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="edit_company">Company</label>
            <input
              id="edit_company"
              name="company"
              type="text"
              defaultValue={lead.company ?? ''}
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="edit_email">Email</label>
              <input
                id="edit_email"
                name="email"
                type="email"
                defaultValue={lead.email ?? ''}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="edit_phone">Phone</label>
              <input
                id="edit_phone"
                name="phone"
                type="tel"
                defaultValue={lead.phone ?? ''}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="edit_source">Source</label>
            <select
              id="edit_source"
              name="source"
              defaultValue={lead.source ?? ''}
              className={INPUT}
            >
              <option value="">— None —</option>
              <option value="web">Web</option>
              <option value="referral">Referral</option>
              <option value="import">Import</option>
              <option value="manual">Manual</option>
              <option value="other">Other</option>
            </select>
          </div>

          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
