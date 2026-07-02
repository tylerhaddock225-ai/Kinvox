'use client'

import { useActionState } from 'react'
import { HQ_PERMISSION_KEYS } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import GroupedPermissionGrid from '@/components/permissions/GroupedPermissionGrid'
import { createHqRole, type HqRoleActionState } from './actions'

export default function CreateHqRoleForm({
  catalog,
}: {
  catalog: CatalogRow[]
}) {
  const [state, formAction, pending] = useActionState<HqRoleActionState, FormData>(
    createHqRole,
    null,
  )

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">
          Role name
        </label>
        <input
          name="name"
          type="text"
          required
          placeholder="e.g. Senior Platform Support"
          className="w-full rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
        />
      </div>

      <div>
        <div className="block text-xs font-medium text-gray-400 mb-2">
          Permissions
        </div>
        {/* Workstream L — grouped + searchable; defaults all-unchecked, matching
            the prior bare checkboxes (no defaultChecked). Payload unchanged. */}
        <GroupedPermissionGrid
          catalog={catalog}
          flatKeys={HQ_PERMISSION_KEYS}
          variant="hq"
          defaults={() => false}
        />
      </div>

      {state?.status === 'error' && (
        <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
      >
        {pending ? 'Creating…' : 'Create role'}
      </button>
    </form>
  )
}
