import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSuperAdmin, hasHqPermission, type HqPermissions } from '@/lib/permissions'
import { getRoleLabel } from '@/lib/types/auth'
import SettingsTabs from './SettingsTabs'
import type {
  HqUserRow,
  HqInviteRow,
  RoleOption,
} from './users/HqUsersClient'
import type { HqRoleRow } from './roles/page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Unified HQ Settings hub (J4) — mirrors org's /settings/team: one entry, a tab
// strip, and a "User Administration" tab that stacks user management (HqUsersClient)
// over HQ Roles. Folds in the former standalone /hq/settings/users + /hq/settings/roles
// pages. The HQ layout already admits only system_role holders, so no extra page-level
// redirect is needed; the underlying actions keep their own hqGate checks (defense in
// depth). Tab/section visibility is gated by the caller's permission bag.
export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve the caller's HQ-global permission bag (organization_id IS NULL,
  // mirroring hq/layout.tsx + hqGate) so we can gate the User Administration tab
  // and its sections. platform_owner short-circuits via isSuperAdmin.
  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, role_id')
    .eq('id', user.id)
    .single<{ system_role: string | null; role_id: string | null }>()

  let permissions: unknown = null
  if (profile?.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('permissions')
      .eq('id', profile.role_id)
      .is('organization_id', null)
      .maybeSingle<{ permissions: unknown }>()
    permissions = role?.permissions ?? null
  }
  const permProfile = { system_role: profile?.system_role ?? null, role: { permissions } }
  const canManageUsers = isSuperAdmin(permProfile) || hasHqPermission(permProfile, 'manage_users')
  const canManageRoles = isSuperAdmin(permProfile) || hasHqPermission(permProfile, 'manage_global_roles')

  // Admin client for the cross-HQ reads (profiles HQ-scope, auth.users email,
  // hq_invitations, HQ roles + member counts). Support settings stay on the SSR
  // client, matching the prior page.
  const admin = createAdminClient()

  const [settingsRes, usersRes, invitesRes, rolesRes, countsRes, userList] = await Promise.all([
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', ['ticket_id_prefix', 'show_affected_tab_field', 'show_record_id_field']),
    admin
      .from('profiles')
      .select('id, full_name, system_role, role_id, roles(name)')
      .not('system_role', 'is', null)
      .order('full_name'),
    admin
      .from('hq_invitations')
      .select('id, email, full_name, system_role, role_id, expires_at')
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
    admin
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .is('organization_id', null)
      .order('name'),
    admin
      .from('profiles')
      .select('role_id')
      .not('role_id', 'is', null)
      .not('system_role', 'is', null),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  // ── Support settings ──────────────────────────────────────────────────────
  const byKey = new Map<string, unknown>((settingsRes.data ?? []).map(r => [r.key, r.value]))
  const currentPrefix   = typeof byKey.get('ticket_id_prefix') === 'string' ? (byKey.get('ticket_id_prefix') as string) : 'tk_'
  const showAffectedTab = byKey.get('show_affected_tab_field') === true
  const showRecordId    = byKey.get('show_record_id_field')    === true

  // ── HQ users (email via auth.users) ───────────────────────────────────────
  const emailById = new Map<string, string>()
  for (const u of userList.data?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email)
  }
  const users: HqUserRow[] = (usersRes.data ?? []).map((u) => ({
    id:                u.id,
    full_name:         u.full_name,
    email:             emailById.get(u.id) ?? null,
    system_role:       u.system_role,
    system_role_label: getRoleLabel(u.system_role),
    role_name:         (u.roles as unknown as { name: string } | null)?.name ?? null,
  }))

  // ── HQ roles (+ member counts) + assignable options ───────────────────────
  const roleCountByRoleId = new Map<string, number>()
  for (const row of countsRes.data ?? []) {
    if (!row.role_id) continue
    roleCountByRoleId.set(row.role_id, (roleCountByRoleId.get(row.role_id) ?? 0) + 1)
  }
  const hqRoles: HqRoleRow[] = (rolesRes.data ?? []).map((r) => ({
    id:             r.id,
    name:           r.name,
    permissions:    r.permissions as unknown as HqPermissions,
    is_system_role: r.is_system_role,
    member_count:   roleCountByRoleId.get(r.id) ?? 0,
  }))
  const roleOptions: RoleOption[] = (rolesRes.data ?? []).map((r) => ({ id: r.id, name: r.name }))
  const roleNameById = new Map(roleOptions.map((r) => [r.id, r.name]))

  // ── Pending HQ invitations ────────────────────────────────────────────────
  const invites: HqInviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id:                i.id,
    email:             i.email,
    full_name:         i.full_name,
    system_role_label: getRoleLabel(i.system_role),
    role_name:         i.role_id ? (roleNameById.get(i.role_id) ?? null) : null,
    expires_at:        i.expires_at,
  }))

  // J5 — system_role is no longer human-selected: inviteHqUser stamps a fixed
  // non-owner identifier server-side (mirrors org stamping role='agent'). The
  // invite form now collects only the HQ Role (permission bag).
  // B5b — pre-select the lone organization_id IS NULL role (HQ Admin).
  const defaultRoleId = roleOptions[0]?.id

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Configuration
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">
          Manage Kinvox HQ staff, roles, and platform-wide configuration.
        </p>
      </div>

      <SettingsTabs
        currentPrefix={currentPrefix}
        showAffectedTab={showAffectedTab}
        showRecordId={showRecordId}
        callerId={user.id}
        users={users}
        invites={invites}
        roleOptions={roleOptions}
        defaultRoleId={defaultRoleId}
        hqRoles={hqRoles}
        canManageUsers={canManageUsers}
        canManageRoles={canManageRoles}
      />
    </div>
  )
}
