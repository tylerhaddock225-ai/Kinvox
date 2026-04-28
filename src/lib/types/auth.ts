// Single source of truth for the `internal_role` ENUM defined in
// supabase/migrations/20240101000000_baseline_schema.sql:55-61. Mirror
// any future ENUM additions here so the type system stays honest about
// what `profiles.system_role` can actually contain.
//
// All five values represent HQ staff. The proxy's sorting hat
// (src/lib/supabase/session.ts) treats any non-null `system_role` as
// platform-equivalent via `role.startsWith('platform_')`. The
// owner/support/admin/sales/accounting differentiation only matters in
// surfaces that gate UI on specific roles — today, that's
// AdminSidebar's owner-only Billing + Roles links.
export type SystemRole =
  | 'platform_owner'
  | 'platform_support'
  | 'platform_admin'
  | 'platform_sales'
  | 'platform_accounting'

// Human-readable labels for each role. Typed as Record<SystemRole, string>
// so adding a new value to SystemRole forces an exhaustiveness error here
// — the next person extending the ENUM can't ship a UI that silently
// falls back to 'Staff' for the new role.
const ROLE_LABELS: Record<SystemRole, string> = {
  platform_owner:      'Platform Owner',
  platform_support:    'Platform Support',
  platform_admin:      'Platform Admin',
  platform_sales:      'Platform Sales',
  platform_accounting: 'Platform Accounting',
}

// Resolve a role to its display label. Accepts wider input than
// SystemRole so callers can pass DB rows directly (system_role is
// nullable in profiles, and may legitimately contain a string outside
// this type if a migration adds a value before we update the type).
// Unknown / null / undefined fall back to 'Staff' rather than crashing
// or rendering the raw enum literal in the UI.
export function getRoleLabel(role: SystemRole | string | null | undefined): string {
  if (role && role in ROLE_LABELS) return ROLE_LABELS[role as SystemRole]
  return 'Staff'
}
