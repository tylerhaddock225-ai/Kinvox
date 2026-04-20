// ── Permission engine ──────────────────────────────────────────────────────
//
// Every role in public.roles carries a JSONB `permissions` bag. This file
// is the single source of truth for:
//   • Which keys exist (so UIs can render a consistent checkbox grid)
//   • Whether a key belongs to the HQ scope or the tenant scope
//   • How to answer "does this profile have permission X?"
//
// New server actions should import `hasOrgPermission` / `hasHqPermission`
// instead of reading `profile.role` directly — that keeps all role gating
// funneled through the same code path.


// ── Scope-split key catalogues ─────────────────────────────────────────────

export const ORG_PERMISSION_KEYS = [
  { key: 'view_leads',        label: 'View Leads'        },
  { key: 'edit_leads',        label: 'Edit Leads'        },
  { key: 'view_tickets',      label: 'View Tickets'      },
  { key: 'edit_tickets',      label: 'Edit Tickets'      },
  { key: 'view_appointments', label: 'View Appointments' },
  { key: 'view_customers',    label: 'View Customers'    },
  { key: 'edit_customers',    label: 'Edit Customers'    },
  { key: 'view_analytics',    label: 'View Analytics'    },
  { key: 'manage_team',       label: 'Manage Team'       },
] as const

export const HQ_PERMISSION_KEYS = [
  { key: 'manage_users',             label: 'Manage Users'             },
  { key: 'manage_global_roles',      label: 'Manage Global Roles'      },
  { key: 'manage_platform_billing',  label: 'Manage Platform Billing'  },
  { key: 'manage_support_settings',  label: 'Manage Support Settings'  },
] as const

export type OrgPermissionKey = typeof ORG_PERMISSION_KEYS[number]['key']
export type HqPermissionKey  = typeof HQ_PERMISSION_KEYS[number]['key']

export type OrgPermissions = Record<OrgPermissionKey, boolean>
export type HqPermissions  = Record<HqPermissionKey,  boolean>

// Legacy alias: previous code imports `PERMISSION_KEYS` / `Permissions` for
// tenant roles. Keep the names pointing at the tenant catalogue so we don't
// need to touch every caller at once.
export const PERMISSION_KEYS = ORG_PERMISSION_KEYS
export type  PermissionKey   = OrgPermissionKey
export type  Permissions     = OrgPermissions

export const DEFAULT_ORG_PERMISSIONS: OrgPermissions = {
  view_leads:        true,
  edit_leads:        true,
  view_tickets:      true,
  edit_tickets:      true,
  view_appointments: true,
  view_customers:    true,
  edit_customers:    true,
  view_analytics:    true,
  manage_team:       false,
}

export const DEFAULT_HQ_PERMISSIONS: HqPermissions = {
  manage_users:             false,
  manage_global_roles:      false,
  manage_platform_billing:  false,
  manage_support_settings:  false,
}

export const DEFAULT_PERMISSIONS = DEFAULT_ORG_PERMISSIONS


// ── Runtime helpers ────────────────────────────────────────────────────────
//
// Profiles reach us via RLS-gated SELECTs that join `profiles → roles` and
// expose a shape like: { role: { permissions: jsonb } | null }. These helpers
// accept that shape (optionally with the join already pre-extracted) and
// return a boolean.

export interface ProfileWithRole {
  role?: { permissions?: unknown } | null
  roles?: { permissions?: unknown } | null
}

function readPermissionBag(profile: ProfileWithRole | null | undefined): Record<string, unknown> | null {
  const bag =
    (profile?.role  as { permissions?: unknown } | null)?.permissions ??
    (profile?.roles as { permissions?: unknown } | null)?.permissions
  return bag && typeof bag === 'object' ? bag as Record<string, unknown> : null
}

function bagHas(bag: Record<string, unknown> | null, key: string): boolean {
  if (!bag) return false
  return bag[key] === true
}

export function hasOrgPermission(
  profile: ProfileWithRole | null | undefined,
  key: OrgPermissionKey,
): boolean {
  return bagHas(readPermissionBag(profile), key)
}

export function hasHqPermission(
  profile: ProfileWithRole | null | undefined,
  key: HqPermissionKey,
): boolean {
  return bagHas(readPermissionBag(profile), key)
}
