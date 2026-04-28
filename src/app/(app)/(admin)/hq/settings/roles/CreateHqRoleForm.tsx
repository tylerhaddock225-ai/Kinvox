'use client'

import { useActionState } from 'react'
import { createHqRole, type HqRoleActionState } from './actions'

export default function CreateHqRoleForm({
  permissionKeys,
}: {
  permissionKeys: { key: string; label: string }[]
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
        <div className="grid grid-cols-2 gap-2">
          {permissionKeys.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500/40 cursor-pointer"
            >
              <input
                type="checkbox"
                name={key}
                className="rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500"
              />
              {label}
            </label>
          ))}
        </div>
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
