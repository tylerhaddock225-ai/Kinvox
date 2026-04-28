import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  HQ_PERMISSION_KEYS,
  hasHqPermission,
  type HqPermissions,
} from '@/lib/permissions'
import HqRolesTable from './HqRolesTable'
import CreateHqRoleForm from './CreateHqRoleForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export type HqRoleRow = {
  id: string
  name: string
  permissions: HqPermissions
  is_system_role: boolean
  member_count: number
}

export default async function HqRolesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Only HQ staff with manage_global_roles may land here. Every other
  // HQ staffer lands at /hq (read-only access to this page would
  // be misleading because they can't persist changes anyway).
  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, role:roles(permissions)')
    .eq('id', user.id)
    .single<{
      system_role: string | null
      role: { permissions: unknown } | null
    }>()

  if (!profile?.system_role) redirect('/login')
  if (!hasHqPermission(profile, 'manage_global_roles')) redirect('/hq')

  // Fetch roles + in-use counts in parallel. The count query lives in
  // a grouped aggregate; we read both sides and merge client-side.
  const [rolesRes, profilesRes] = await Promise.all([
    supabase
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .is('organization_id', null)
      .order('name'),
    supabase
      .from('profiles')
      .select('role_id')
      .not('role_id', 'is', null)
      .not('system_role', 'is', null),
  ])

  const roleCountByRoleId = new Map<string, number>()
  for (const row of profilesRes.data ?? []) {
    if (!row.role_id) continue
    roleCountByRoleId.set(row.role_id, (roleCountByRoleId.get(row.role_id) ?? 0) + 1)
  }

  const rows: HqRoleRow[] = (rolesRes.data ?? []).map(r => ({
    id:             r.id,
    name:           r.name,
    permissions:    r.permissions as unknown as HqPermissions,
    is_system_role: r.is_system_role,
    member_count:   roleCountByRoleId.get(r.id) ?? 0,
  }))

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Configuration
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">HQ Roles</h1>
        <p className="mt-1 text-sm text-gray-400">
          Permission bundles for Kinvox HQ staff. These roles are not visible
          to tenant organizations; organizations define their own role set at
          /settings/team.
        </p>
      </div>

      <section className="rounded-xl border border-pvx-border bg-pvx-surface p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Existing roles</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No HQ roles yet.</p>
        ) : (
          <HqRolesTable rows={rows} />
        )}
      </section>

      <section className="rounded-xl border border-pvx-border bg-pvx-surface p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Create new role</h2>
        <CreateHqRoleForm permissionKeys={HQ_PERMISSION_KEYS.map(k => ({ ...k }))} />
      </section>
    </div>
  )
}
