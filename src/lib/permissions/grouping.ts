// Workstream L — display-only grouping for the roles permission grids.
//
// public.permission_catalog (seeded by migration, never written from app code)
// carries the presentation taxonomy — group_slug / group_label / action_tier /
// sort_order — that the flat ORG_PERMISSION_KEYS / HQ_PERMISSION_KEYS arrays in
// ../permissions lack. These helpers join the two so the org + HQ role editors
// can render grouped, tier-sorted sections WITHOUT changing which keys exist or
// what the forms submit.
//
// CRITICAL — INTERSECTION ONLY: everything here is filtered through the caller's
// `allowedKeys` (the hardcoded arrays). Catalog-only keys — notably the 4
// delete_* org keys, which live in the catalog + the system-role bags but NOT in
// the arrays or the form parsers (parsePermissions / parseHqPermissions) — are
// dropped so no checkbox is rendered that a parser would silently discard. Do
// NOT widen allowedKeys to "fix" a missing delete_* toggle; that would change the
// write surface.

// The table is not in database.types.ts (it was never queried until L) and the
// SSR reads use an untyped client, so this hand-typed row shape is the contract.
export type CatalogRow = {
  key:              string
  scope:            'org' | 'hq'
  group_slug:       string
  group_label:      string
  permission_label: string
  description:      string | null
  action_tier:      string
  sort_order:       number
}

export type GroupedPermission = {
  key:   string
  label: string
  tier:  string
}

export type PermissionGroup = {
  slug:        string
  label:       string
  permissions: GroupedPermission[]
}

// Group the catalog rows into ordered sections, keeping ONLY keys present in
// `allowedKeys` (the intersection). Groups are ordered by their minimum
// sort_order then label; keys within a group by sort_order then key.
export function groupPermissions(
  rows: CatalogRow[],
  allowedKeys: readonly string[],
): PermissionGroup[] {
  const allowed = new Set(allowedKeys)

  const bySlug = new Map<string, { label: string; minSort: number; rows: CatalogRow[] }>()
  for (const row of rows) {
    if (!allowed.has(row.key)) continue // INTERSECTION — drop catalog-only keys
    const bucket = bySlug.get(row.group_slug)
    if (bucket) {
      bucket.rows.push(row)
      if (row.sort_order < bucket.minSort) bucket.minSort = row.sort_order
    } else {
      bySlug.set(row.group_slug, { label: row.group_label, minSort: row.sort_order, rows: [row] })
    }
  }

  return Array.from(bySlug.entries())
    .map(([slug, b]) => ({
      slug,
      label:   b.label,
      minSort: b.minSort,
      permissions: b.rows
        .slice()
        .sort((a, c) => a.sort_order - c.sort_order || a.key.localeCompare(c.key))
        .map((r) => ({ key: r.key, label: r.permission_label, tier: r.action_tier })),
    }))
    .sort((a, b) => a.minSort - b.minSort || a.label.localeCompare(b.label))
    .map(({ slug, label, permissions }) => ({ slug, label, permissions }))
}

// Flat, grouped-order list of {key,label} for the read-only pill displays, which
// want the catalog's ordering but no section chrome. Falls back to the array's
// own order + labels when the catalog is empty, and appends any allowed key the
// catalog didn't cover (in array order) so a key can never silently disappear
// from a role's displayed permission set.
export function orderedPermissions(
  rows: CatalogRow[],
  flatKeys: readonly { key: string; label: string }[],
): { key: string; label: string }[] {
  if (rows.length === 0) return flatKeys.map((k) => ({ key: k.key, label: k.label }))

  const groups  = groupPermissions(rows, flatKeys.map((k) => k.key))
  const ordered = groups.flatMap((g) => g.permissions.map((p) => ({ key: p.key, label: p.label })))

  const seen = new Set(ordered.map((p) => p.key))
  for (const k of flatKeys) if (!seen.has(k.key)) ordered.push({ key: k.key, label: k.label })
  return ordered
}
