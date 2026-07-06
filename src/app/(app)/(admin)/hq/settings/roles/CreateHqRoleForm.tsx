'use client'

import { useActionState, useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { HQ_PERMISSION_KEYS } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import GroupedPermissionGrid from '@/components/permissions/GroupedPermissionGrid'
import { createHqRole, type HqRoleActionState } from './actions'

// ── HQ style tokens (emerald accent) ─────────────────────────────────────────
// Local to the HQ role modals — there's no shared HQ BTN token. Mirrors the org
// BTN_PRIMARY/BTN_SECONDARY structure from TeamTabs, swapping indigo → emerald.
const INPUT  = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'
const LABEL  = 'block text-xs font-medium text-gray-400 mb-1'
const BTN    = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-emerald-600 text-white hover:bg-emerald-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

// HQ create-role modal. Mirrors the org CreateRoleModal (settings/team/TeamTabs)
// widen + internal-scroll + pinned-footer skeleton, in HQ's emerald theme. The
// dialog MUST use `open:flex` (not bare `flex`): an author `display:flex` beats
// the UA `dialog:not([open]){display:none}` rule, so a bare flex would render the
// closed dialog inline. `min-h-0` on the flex chain is what lets the body's
// overflow-y-auto engage. Server action + checkbox payload are unchanged — this
// is presentation only.
export default function CreateHqRoleModal({
  catalog,
}: {
  catalog: CatalogRow[]
}) {
  const [state, formAction, pending] = useActionState<HqRoleActionState, FormData>(
    createHqRole,
    null,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef   = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.status === 'success') {
      dialogRef.current?.close()
      formRef.current?.reset()
    }
  }, [state])

  return (
    <>
      <button className={BTN_PRIMARY} onClick={() => dialogRef.current?.showModal()}>
        <Plus className="w-4 h-4" />
        New role
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto w-[calc(100%-2rem)] max-w-4xl max-h-[85vh] open:flex open:flex-col overflow-hidden rounded-xl border border-emerald-500/20 bg-gray-900 text-white shadow-2xl backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-base font-semibold">Create Role</h2>
          <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form ref={formRef} action={formAction} className="flex flex-col min-h-0 flex-1">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-5">
            <div>
              <label className={LABEL} htmlFor="hq-role-name">Role name <span className="text-red-400">*</span></label>
              <input
                id="hq-role-name"
                name="name"
                type="text"
                required
                placeholder="e.g. Senior Platform Support"
                className={INPUT}
              />
            </div>

            <div>
              <p className={LABEL}>Permissions</p>
              <div className="mt-2 p-3 rounded-lg border border-gray-800 bg-black/25">
                {/* Workstream L — grouped + searchable; defaults all-unchecked.
                    Checkbox names/payload unchanged. */}
                <GroupedPermissionGrid
                  catalog={catalog}
                  flatKeys={HQ_PERMISSION_KEYS}
                  variant="hq"
                  defaults={() => false}
                />
              </div>
            </div>

            {state?.status === 'error' && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {state.error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-800 shrink-0">
            <button type="button" onClick={() => dialogRef.current?.close()} className={BTN_SECONDARY}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={BTN_PRIMARY}>
              {pending ? 'Creating…' : 'Create Role'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}
