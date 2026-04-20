'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { HQ_PERMISSION_KEYS, type HqPermissions } from '@/lib/permissions'
import { updateHqRole, deleteHqRole, type HqRoleActionState } from './actions'
import type { HqRoleRow } from './page'

export default function HqRolesTable({ rows }: { rows: HqRoleRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <RoleCard key={r.id} row={r} />
      ))}
    </div>
  )
}

function RoleCard({ row }: { row: HqRoleRow }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      {editing ? (
        <EditForm row={row} onDone={() => setEditing(false)} />
      ) : (
        <ViewMode row={row} onEdit={() => setEditing(true)} />
      )}
    </div>
  )
}

function ViewMode({ row, onEdit }: { row: HqRoleRow; onEdit: () => void }) {
  const grantedKeys = HQ_PERMISSION_KEYS
    .filter(({ key }) => row.permissions[key as keyof HqPermissions])
    .map(({ label }) => label)

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
        <div className="mt-2 text-xs text-gray-400">
          {grantedKeys.length === 0 ? (
            <span className="text-gray-600">No permissions granted</span>
          ) : (
            grantedKeys.join(' · ')
          )}
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

function EditForm({ row, onDone }: { row: HqRoleRow; onDone: () => void }) {
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

      <div className="grid grid-cols-2 gap-2">
        {HQ_PERMISSION_KEYS.map(({ key, label }) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500/40 cursor-pointer"
          >
            <input
              type="checkbox"
              name={key}
              defaultChecked={row.permissions[key as keyof HqPermissions]}
              className="rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
            />
            {label}
          </label>
        ))}
      </div>

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
