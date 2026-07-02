'use client'

// Workstream L — the shared grouped + searchable permission checkbox grid.
// Used by all four editable role grids (org create/edit, HQ create/edit). It
// renders the SAME <input type="checkbox" name={key}> controls as before, so the
// form submit payload is byte-identical to the pre-L flat grids; L only adds
// group headers (collapsible) and a local search box on top.
//
// Uncontrolled-form safety: every checkbox is ALWAYS mounted. Search and collapse
// hide controls with the `hidden` class (display:none) rather than unmounting
// them — display:none inputs still submit, and staying mounted preserves any
// user toggle across searching/collapsing. Never swap `hidden` for conditional
// (un)mounting here.

import { useMemo, useState } from 'react'
import { Search, X, ChevronDown, ChevronRight } from 'lucide-react'
import { groupPermissions, type CatalogRow } from '@/lib/permissions/grouping'

type FlatKey = { key: string; label: string }
type Variant = 'org' | 'hq'

// Per-surface checkbox styling — verbatim from the pre-L grids so the only change
// is grouping + search, never the control's look.
const VARIANT: Record<Variant, { labelClass: string; inputClass: string; withSpan: boolean }> = {
  org: {
    labelClass: 'flex items-center gap-2 cursor-pointer',
    inputClass: 'w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-900',
    withSpan:   true,
  },
  hq: {
    labelClass: 'flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-200 hover:border-emerald-500/40 cursor-pointer',
    inputClass: 'rounded border-gray-700 bg-gray-800 text-emerald-500 focus:ring-emerald-500',
    withSpan:   false,
  },
}

function Checkbox({
  perm,
  defaultChecked,
  variant,
  hidden,
}: {
  perm: FlatKey
  defaultChecked: boolean
  variant: Variant
  hidden: boolean
}) {
  const v = VARIANT[variant]
  return (
    <label className={`${v.labelClass}${hidden ? ' hidden' : ''}`}>
      <input type="checkbox" name={perm.key} defaultChecked={defaultChecked} className={v.inputClass} />
      {v.withSpan ? <span className="text-sm text-gray-300">{perm.label}</span> : perm.label}
    </label>
  )
}

export default function GroupedPermissionGrid({
  catalog,
  flatKeys,
  defaults,
  variant,
}: {
  catalog:  CatalogRow[]
  flatKeys: readonly FlatKey[]
  /** Initial checked state for a key — mirrors each form's prior defaultChecked. */
  defaults: (key: string) => boolean
  variant:  Variant
}) {
  const allowedKeys = useMemo(() => flatKeys.map((k) => k.key), [flatKeys])

  // Group only when the catalog fully covers the allowed set. If the catalog is
  // empty (RLS surprise) OR misses a key, a checkbox would go unrendered and the
  // form would submit that key as false on edit — a payload change. In that case
  // fall back to the flat grid, which always renders every allowed key.
  const groups = useMemo(() => {
    if (catalog.length === 0) return null
    const g = groupPermissions(catalog, allowedKeys)
    const covered = new Set(g.flatMap((x) => x.permissions.map((p) => p.key)))
    if (allowedKeys.some((k) => !covered.has(k))) return null
    return g
  }, [catalog, allowedKeys])

  const [query, setQuery]         = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // FALLBACK — the exact pre-L flat grid (no groups, no search).
  if (!groups) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {flatKeys.map((k) => (
          <Checkbox key={k.key} perm={k} defaultChecked={defaults(k.key)} variant={variant} hidden={false} />
        ))}
      </div>
    )
  }

  const q         = query.trim().toLowerCase()
  const searching = q.length > 0
  const matches   = (label: string) => !searching || label.toLowerCase().includes(q)

  const toggle = (slug: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  return (
    <div className="space-y-3">
      {/* Search — mirrors LeadsFilters markup. No `name`, so it never submits;
          Enter is swallowed so it can't submit the surrounding role form. */}
      <div className="relative">
        <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
          placeholder="Search permissions…"
          className="w-full rounded-lg border border-pvx-border bg-pvx-surface pl-9 pr-8 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {groups.map((group) => {
        const groupHasMatch = group.permissions.some((p) => matches(p.label))
        const groupHidden   = searching && !groupHasMatch
        const bodyCollapsed = !searching && collapsed.has(group.slug) // a search force-expands
        return (
          <div key={group.slug} className={groupHidden ? 'hidden' : ''}>
            <button
              type="button"
              onClick={() => toggle(group.slug)}
              className="flex w-full items-center gap-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-200 transition-colors"
            >
              {bodyCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                : <ChevronDown  className="w-3.5 h-3.5 shrink-0" />}
              {group.label}
            </button>
            <div className={`grid grid-cols-2 gap-2 mt-1.5${bodyCollapsed ? ' hidden' : ''}`}>
              {group.permissions.map((p) => (
                <Checkbox
                  key={p.key}
                  perm={{ key: p.key, label: p.label }}
                  defaultChecked={defaults(p.key)}
                  variant={variant}
                  hidden={searching && !matches(p.label)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
