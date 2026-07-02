'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { HQ_PERMISSION_KEYS } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import GroupedPermissionGrid from '@/components/permissions/GroupedPermissionGrid'
import PermissionPills from '@/components/permissions/PermissionPills'
import { updateHqRole, deleteHqRole, type HqRoleActionState } from './actions'
import type { HqRoleRow } from './page'

export default function HqRolesTable({ rows, catalog }: { rows: HqRoleRow[]; catalog: CatalogRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <RoleCard key={r.id} row={r} catalog={catalog} />
      ))}
    </div>
  )
}

function RoleCard({ row, catalog }: { row: HqRoleRow; catalog: CatalogRow[] }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="rounded-lg border border-pvx-border bg-pvx-surface p-4">
      {editing ? (
        <EditForm row={row} onDone={() => setEditing(false)} catalog={catalog} />
      ) : (
        <ViewMode row={row} onEdit={() => setEditing(true)} catalog={catalog} />
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

function EditForm({ row, onDone, catalog }: { row: HqRoleRow; onDone: () => void; catalog: CatalogRow[] }) {
  const [state, formAction, pending] = useActionState<HqRoleActionState, FormData>(
    async (prev, fd) => {
      const result = await updateHqRole(prev, fd)
      if (result?.status === 'success') onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="role_id" value={row.id} />

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          Role name
        </label>
        <input
          name="name"
          type="text"
          defaultValue={row.name}
          required
          className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <GroupedPermissionGrid
        catalog={catalog}
        flatKeys={HQ_PERMISSION_KEYS}
        variant="hq"
        defaults={(key) => Boolean((row.permissions as Record<string, boolean>)[key])}
      />

      {state?.status === 'error' && (
        <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
