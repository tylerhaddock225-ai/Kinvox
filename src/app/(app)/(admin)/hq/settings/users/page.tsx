import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hqGate } from '@/lib/permissions/gates'
import { SYSTEM_ROLES, getRoleLabel } from '@/lib/types/auth'
import HqUsersClient, {
  type HqUserRow,
  type HqInviteRow,
  type RoleOption,
  type SystemRoleOption,
} from './HqUsersClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function HqUsersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Page-level gate on hqGate('manage_users'). The HQ layout already admits only
  // system_role holders; this narrows to staff who can manage users. Same gate
  // the inviteHqUser / resendHqInvite actions enforce — defense in depth.
  const gate = await hqGate(supabase, user.id, 'manage_users')
  if (!gate.ok) redirect('/hq')

  // Admin client: these are cross-org/HQ reads (profiles HQ-scope + auth.users
  // for email + hq_invitations HQ-scope). Mirrors the tenant team page, which
  // also resolves emails through the GoTrue admin API since profiles has no
  // email column and auth.users isn't reachable via PostgREST.
  const admin = createAdminClient()

  const [usersRes, rolesRes, invitesRes, userList] = await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, system_role, role_id, roles(name)')
      .not('system_role', 'is', null)
      .order('full_name'),
    admin
      .from('roles')
      .select('id, name')
      .is('organization_id', null)
      .order('name'),
    admin
      .from('hq_invitations')
      .select('id, email, full_name, system_role, role_id, expires_at')
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])

  // id → email map from auth.users (one listUsers call, mirrors inviteMember).
  const emailById = new Map<string, string>()
  for (const u of userList.data?.users ?? []) {
    if (u.email) emailById.set(u.id, u.email)
  }

  const users: HqUserRow[] = (usersRes.data ?? []).map((u) => ({
    id:          u.id,
    full_name:   u.full_name,
    email:       emailById.get(u.id) ?? null,
    system_role: u.system_role,
    system_role_label: getRoleLabel(u.system_role),
    role_name:   (u.roles as unknown as { name: string } | null)?.name ?? null,
  }))

  const roleOptions: RoleOption[] = (rolesRes.data ?? []).map((r) => ({ id: r.id, name: r.name }))
  const roleNameById = new Map(roleOptions.map((r) => [r.id, r.name]))

  const invites: HqInviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id:                i.id,
    email:             i.email,
    full_name:         i.full_name,
    system_role_label: getRoleLabel(i.system_role),
    role_name:         i.role_id ? (roleNameById.get(i.role_id) ?? null) : null,
    expires_at:        i.expires_at,
  }))

  // All internal_role values for the invite form's system_role <select>.
  const systemRoleOptions: SystemRoleOption[] = SYSTEM_ROLES.map((r) => ({
    value: r,
    label: getRoleLabel(r),
  }))

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Configuration
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">HQ Users</h1>
        <p className="mt-1 text-sm text-gray-400">
          Invite and manage Kinvox HQ staff. HQ users have a platform role and no
          tenant organization; tenant teammates are managed inside each
          organization at /settings/team.
        </p>
      </div>

      <HqUsersClient
        users={users}
        invites={invites}
        roleOptions={roleOptions}
        systemRoleOptions={systemRoleOptions}
      />
    </div>
  )
}
