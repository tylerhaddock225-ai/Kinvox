import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveImpersonation } from '@/lib/impersonation'
import { redirect } from 'next/navigation'
import TeamTabs from './TeamTabs'
import type { Permissions } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export type MemberRow = {
  id: string
  full_name: string | null
  email: string | null
  system_role: 'admin' | 'agent' | 'viewer'
  role_id: string | null
  role_name: string | null
}

export type RoleRow = {
  id: string
  name: string
  permissions: Permissions
  is_system_role: boolean
}

export default async function TeamSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; role: string | null }>(),
    resolveImpersonation(),
  ])

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  // An HQ admin who has passed resolveImpersonation's is_admin_hq gate
  // is treated as a tenant admin on the impersonated org for read
  // access; tenant role is only enforced when the caller is acting as
  // themselves.
  if (!impersonation.active && profile?.role !== 'admin') redirect('/')

  const orgId = effectiveOrgId

  // Fetch members, roles, and the org settings row in parallel
  const [membersRes, rolesRes, orgRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, role_id, roles(id, name)')
      .eq('organization_id', orgId),
    supabase
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .eq('organization_id', orgId)
      .order('name'),
    supabase
      .from('organizations')
      .select('inbound_email_address, verified_support_email, verified_support_email_confirmed_at')
      .eq('id', orgId)
      .single(),
  ])

  // Fetch emails via admin API
  const admin = createAdminClient()
  const emailMap: Record<string, string> = {}
  await Promise.all(
    (membersRes.data ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.id)
      if (data?.user?.email) emailMap[m.id] = data.user.email
    })
  )

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    email: emailMap[m.id] ?? null,
    system_role: m.role as MemberRow['system_role'],
    role_id: m.role_id,
    role_name: (m.roles as unknown as { name: string } | null)?.name ?? null,
  }))

  const roles: RoleRow[] = (rolesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissions as unknown as Permissions,
    is_system_role: r.is_system_role,
  }))

  const orgSettings = {
    inbound_email_address:               orgRes.data?.inbound_email_address               ?? null,
    verified_support_email:              orgRes.data?.verified_support_email              ?? null,
    verified_support_email_confirmed_at: orgRes.data?.verified_support_email_confirmed_at ?? null,
  }

  return (
    <div className="px-8 py-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Organization Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your organization, team, and how customers reach you.
        </p>
      </div>
      <TeamTabs members={members} roles={roles} orgSettings={orgSettings} />
    </div>
  )
}
