'use client'

import { useActionState, useRef } from 'react'
import { X, UserPlus } from 'lucide-react'
import { createNewCustomer, type CreateCustomerState } from '@/app/(app)/(dashboard)/actions/customers'

const INPUT = 'w-full rounded-lg border border-pvx-border bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500'
const LABEL = 'block text-xs font-medium text-gray-400 mb-1'

export default function NewCustomerModal() {
  const [state, action, pending] = useActionState<CreateCustomerState, FormData>(createNewCustomer, null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

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
        <UserPlus className="w-4 h-4" />
        New Customer
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-full max-w-md rounded-xl border border-pvx-border bg-pvx-surface p-6 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">New Customer</h2>
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
              <label className={LABEL} htmlFor="new_cust_first_name">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                id="new_cust_first_name"
                name="first_name"
                type="text"
                required
                placeholder="Jane"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="new_cust_last_name">Last Name</label>
              <input
                id="new_cust_last_name"
                name="last_name"
                type="text"
                placeholder="Smith"
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className={LABEL} htmlFor="new_cust_company">Company</label>
            <input
              id="new_cust_company"
              name="company"
              type="text"
              placeholder="Acme Corp"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="new_cust_email">Email</label>
              <input
                id="new_cust_email"
                name="email"
                type="email"
                placeholder="jane@example.com"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="new_cust_phone">Phone</label>
              <input
                id="new_cust_phone"
                name="phone"
                type="tel"
                placeholder="555-0100"
                className={INPUT}
              />
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
              {pending ? 'Saving…' : 'Save Customer'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
