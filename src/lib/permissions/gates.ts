// Workstream K Stage 1 — canonical permission gates (additive, fail-closed).
//
// orgGate / hqGate are the consolidation target for the 37 existing gate sites
// (requireTenantAdmin / requireSettingsAdmin / requireOrgAdmin / rpc('is_admin_hq')
// / inline role checks). K2 retrofits the call sites onto these; this file is
// purely additive and touches no existing gate.
//
// Both gates resolve the caller's role permissions bag through the existing
// hasOrgPermission / hasHqPermission helpers (their signatures are left intact —
// we hand them a ProfileWithRole shaped object carrying the fetched role's bag).
// The legacy BACK-COMPAT branches (tenant role==='admin' / any non-null
// system_role) were removed in K2c-A now that every admin holds the
// corresponding permission-bag role; only the bag + isSuperAdmin (platform_owner)
// paths remain.

import type { createClient } from '@/lib/supabase/server'
import {
  hasOrgPermission,
  hasHqPermission,
  isSuperAdmin,
  type OrgPermissionKey,
  type HqPermissionKey,
} from '@/lib/permissions'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// Re-export the key unions so call sites can import them alongside the gates.
export type { OrgPermissionKey, HqPermissionKey }

export type GateResult = { ok: true } | { ok: false; reason: string }

/**
 * Tenant-scope permission gate. Order of precedence:
 *   1. HQ impersonation — acting on an org that isn't the caller's own AND the
 *      caller is a verified HQ admin (RLS-backed is_admin_hq()).
 *   2. Permission bag — the caller's role grants `permissionKey`
 *      (platform_owner short-circuits inside hasOrgPermission).
 * Fail-closed otherwise.
 */
export async function orgGate(
  supabase: SupabaseServerClient,
  userId: string,
  orgId: string,
  permissionKey: OrgPermissionKey,
): Promise<GateResult> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role_id, system_role')
    .eq('id', userId)
    .single<{
      organization_id: string | null
      role_id: string | null
      system_role: string | null
    }>()

  if (!profile) return { ok: false, reason: 'permission_denied' }

  // 1. HQ admin impersonating another org.
  if (profile.organization_id !== orgId) {
    const { data: isAdminHq } = await supabase.rpc('is_admin_hq')
    if (isAdminHq) return { ok: true }
  }

  // 2. Permission-bag check via the caller's assigned role.
  if (profile.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', profile.role_id)
      .maybeSingle<{ permissions: unknown }>()
    if (
      hasOrgPermission(
        { system_role: profile.system_role, role: { permissions: role?.permissions } },
        permissionKey,
      )
    ) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'permission_denied' }
}

/**
 * HQ-scope permission gate. Order of precedence:
 *   1. platform_owner super-admin bypass.
 *   2. Permission bag — the caller's HQ-global role grants `permissionKey`.
 * Fail-closed otherwise.
 */
export async function hqGate(
  supabase: SupabaseServerClient,
  userId: string,
  permissionKey: HqPermissionKey,
): Promise<GateResult> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role_id, system_role')
    .eq('id', userId)
    .single<{ role_id: string | null; system_role: string | null }>()

  if (!profile) return { ok: false, reason: 'permission_denied' }

  // 1. platform_owner bypasses every check.
  if (isSuperAdmin({ system_role: profile.system_role })) return { ok: true }

  // 2. Permission-bag check via the caller's HQ-global role (organization_id IS NULL).
  if (profile.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', profile.role_id)
      .is('organization_id', null)
      .maybeSingle<{ permissions: unknown }>()
    if (
      hasHqPermission(
        { system_role: profile.system_role, role: { permissions: role?.permissions } },
        permissionKey,
      )
    ) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'permission_denied' }
}
