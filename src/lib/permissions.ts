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
  // ── Workstream K Stage 1 expansion ──────────────────────────────────────
  { key: 'edit_appointments',           label: 'Edit Appointments'         },
  { key: 'view_signals',                label: 'View Signals'              },
  { key: 'manage_signals',              label: 'Act on Signals'            },
  { key: 'edit_signal_settings',        label: 'Edit Signal Settings'      },
  { key: 'manage_social_connections',   label: 'Manage Social Connections' },
  { key: 'manage_lead_settings',        label: 'Manage Lead Settings'      },
  { key: 'manage_org_support_settings', label: 'Manage Support Settings'   },
  { key: 'manage_org_settings',         label: 'Manage Org Settings'       },
  { key: 'manage_billing',              label: 'Manage Billing'            },
  { key: 'manage_roles',                label: 'Manage Roles'              },
] as const

export const HQ_PERMISSION_KEYS = [
  { key: 'manage_users',             label: 'Manage Users'             },
  { key: 'manage_global_roles',      label: 'Manage Global Roles'      },
  { key: 'manage_global_settings',   label: 'Manage Global Settings'   },
  { key: 'manage_platform_billing',  label: 'Manage Platform Billing'  },
  { key: 'manage_support_settings',  label: 'Manage Support Settings'  },
  // ── Workstream K Stage 1 expansion ──────────────────────────────────────
  { key: 'manage_organizations',     label: 'Manage Organizations'     },
  { key: 'manage_org_integrations',  label: 'Manage Org Integrations'  },
  { key: 'send_claim_invites',       label: 'Send Claim Invites'       },
  { key: 'approve_applications',     label: 'Approve Applications'     },
  { key: 'manage_platform_tickets',  label: 'Manage Platform Tickets'  },
  { key: 'manage_ai_templates',      label: 'Manage AI Templates'      },
  { key: 'manage_credits',           label: 'Manage Credits'           },
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
  // ── Workstream K Stage 1 expansion (new custom-role defaults: views/edits
  //    on, management gated — mirrors the manage_team:false convention) ──────
  edit_appointments:           true,
  view_signals:                true,
  manage_signals:              false,
  edit_signal_settings:        true,
  manage_social_connections:   false,
  manage_lead_settings:        false,
  manage_org_support_settings: false,
  manage_org_settings:         false,
  manage_billing:              false,
  manage_roles:                false,
}

export const DEFAULT_HQ_PERMISSIONS: HqPermissions = {
  manage_users:             false,
  manage_global_roles:      false,
  manage_global_settings:   false,
  manage_platform_billing:  false,
  manage_support_settings:  false,
  // ── Workstream K Stage 1 expansion (conservative: all new HQ keys off) ────
  manage_organizations:     false,
  manage_org_integrations:  false,
  send_claim_invites:       false,
  approve_applications:     false,
  manage_platform_tickets:  false,
  manage_ai_templates:      false,
  manage_credits:           false,
}

export const DEFAULT_PERMISSIONS = DEFAULT_ORG_PERMISSIONS


// ── Runtime helpers ────────────────────────────────────────────────────────
//
// Profiles reach us via RLS-gated SELECTs that join `profiles → roles` and
// expose a shape like: { role: { permissions: jsonb } | null }. These helpers
// accept that shape (optionally with the join already pre-extracted) and
// return a boolean.

export interface ProfileWithRole {
  system_role?: string | null
  role?: { permissions?: unknown } | null
  roles?: { permissions?: unknown } | null
}

// Super Admin — platform_owner bypasses every permission check so a
// freshly-promoted owner never gets trapped behind missing bits in
// the permissions bag. Every other role (platform_admin, tenant
// admin, etc) goes through the regular JSONB lookup.
export function isSuperAdmin(profile: ProfileWithRole | null | undefined): boolean {
  return profile?.system_role === 'platform_owner'
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
  if (isSuperAdmin(profile)) return true
  return bagHas(readPermissionBag(profile), key)
}

export function hasHqPermission(
  profile: ProfileWithRole | null | undefined,
  key: HqPermissionKey,
): boolean {
  if (isSuperAdmin(profile)) return true
  return bagHas(readPermissionBag(profile), key)
}
