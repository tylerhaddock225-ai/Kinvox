'use client'

// Workstream L — shared read-only permission pill list for the role-card
// displays (org RolesPanel + HQ RolesTable ViewMode). Renders every allowed key
// as a pill, emerald when granted / gray struck-through when not, ordered by the
// catalog's grouped order (falls back to the array's own order when the catalog
// is empty). Read-only: no inputs, so it never touches the write payload.

import { orderedPermissions, type CatalogRow } from '@/lib/permissions/grouping'

export default function PermissionPills({
  catalog,
  flatKeys,
  granted,
}: {
  catalog:  CatalogRow[]
  flatKeys: readonly { key: string; label: string }[]
  granted:  (key: string) => boolean
}) {
  const ordered = orderedPermissions(catalog, flatKeys)
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map(({ key, label }) => (
        <span
          key={key}
          className={`text-xs px-2 py-0.5 rounded-full border ${
            granted(key)
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-gray-700/50 text-gray-500 border-gray-700 line-through'
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
