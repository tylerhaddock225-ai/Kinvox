'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { HQ_PERMISSION_KEYS } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import GroupedPermissionGrid from '@/components/permissions/GroupedPermissionGrid'
import PermissionPills from '@/components/permissions/PermissionPills'
import { updateHqRole, deleteHqRole, type HqRoleActionState } from './actions'
import type { HqRoleRow } from './page'

// ── HQ style tokens (emerald accent) ─────────────────────────────────────────
// Local to the edit modal — mirrors CreateHqRoleForm's tokens (org BTN structure,
// indigo → emerald).
const INPUT  = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'
const LABEL  = 'block text-xs font-medium text-gray-400 mb-1'
const BTN    = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-emerald-600 text-white hover:bg-emerald-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

export default function HqRolesTable({ rows, catalog }: { rows: HqRoleRow[]; catalog: CatalogRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <RoleCard key={r.id} row={r} catalog={catalog} />
      ))}
    </div>
  )
}

// Persistent ViewMode card + a conditionally-mounted edit modal (mirrors org's
// RolesPanel: the row stays put and EditHqRoleModal overlays the page). The old
// in-card ViewMode↔EditForm swap is gone.
function RoleCard({ row, catalog }: { row: HqRoleRow; catalog: CatalogRow[] }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="rounded-lg border border-pvx-border bg-pvx-surface p-4">
      <ViewMode row={row} onEdit={() => setEditing(true)} catalog={catalog} />
      {editing && (
        <EditHqRoleModal
          key={row.id}
          row={row}
          onClose={() => setEditing(false)}
          catalog={catalog}
        />
      )}
    </div>
  )
}

function ViewMode({ row, onEdit, catalog }: { row: HqRoleRow; onEdit: () => void; catalog: CatalogRow[] }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white text-sm">{row.name}</span>
          {row.is_system_role && (
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
              Seeded
            </span>
          )}
          <span className="text-xs text-gray-500">
            {row.member_count} {row.member_count === 1 ? 'member' : 'members'}
          </span>
        </div>
        <div className="mt-2">
          <PermissionPills
            catalog={catalog}
            flatKeys={HQ_PERMISSION_KEYS}
            granted={(key) => Boolean((row.permissions as Record<string, boolean>)[key])}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
        >
          Edit
        </button>
        {!row.is_system_role && (
          <form action={deleteHqRole}>
            <input type="hidden" name="role_id" value={row.id} />
            <button
              type="submit"
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 transition-colors"
            >
              Delete
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// HQ edit-role modal. Mirrors the org EditRoleModal: self-opens on mount, closes
// on success via onClose, same widen/scroll/pinned-footer skeleton in emerald.
// `open:flex` keeps the closed dialog hidden (author flex would beat the UA hide);
// `min-h-0` enables the body scroll. Server action + payload unchanged.
function EditHqRoleModal({
  row,
  onClose,
  catalog,
}: {
  row: HqRoleRow
  onClose: () => void
  catalog: CatalogRow[]
}) {
  const [state, formAction, pending] = useActionState<HqRoleActionState, FormData>(
    updateHqRole,
    null,
  )
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => { dialogRef.current?.showModal() }, [])
  useEffect(() => {
    if (state?.status === 'success') onClose()
  }, [state, onClose])

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-4xl max-h-[85vh] open:flex open:flex-col overflow-hidden rounded-xl border border-emerald-500/20 bg-gray-900 text-white shadow-2xl backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
        <h2 className="text-base font-semibold">Edit Role</h2>
        <button type="button" onClick={() => dialogRef.current?.close()} className="text-gray-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <form action={formAction} className="flex flex-col min-h-0 flex-1">
        <input type="hidden" name="role_id" value={row.id} />

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-2 space-y-5">
          <div>
            <label className={LABEL} htmlFor="edit-hq-role-name">Role name <span className="text-red-400">*</span></label>
            <input
              id="edit-hq-role-name"
              name="name"
              type="text"
              required
              defaultValue={row.name}
              className={INPUT}
            />
          </div>

          <div>
            <p className={LABEL}>Permissions</p>
            <div className="mt-2 p-3 rounded-lg border border-gray-800 bg-black/25">
              <GroupedPermissionGrid
                catalog={catalog}
                flatKeys={HQ_PERMISSION_KEYS}
                variant="hq"
                defaults={(key) => Boolean((row.permissions as Record<string, boolean>)[key])}
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
            {pending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
