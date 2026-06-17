import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminGlobalSearch from '@/components/admin/AdminGlobalSearch'
import { isTeamEmail } from '@/lib/auth/is-team'
import { isSuperAdmin, hasHqPermission } from '@/lib/permissions'
import type { SystemRole } from '@/lib/types/auth'

export default async function AdminHqLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, role_id')
    .eq('id', user.id)
    .single<{ system_role: SystemRole | null; role_id: string | null }>()

  // Gate has to stay symmetric with the sorting hat in
  // src/lib/supabase/session.ts. The hat sends @kinvoxtech.com users
  // to /hq even before profiles.system_role is provisioned. If we
  // redirect them out on null role, the hat sends them right back —
  // infinite loop, browser eventually shows ERR_TOO_MANY_REDIRECTS,
  // and the user manually backs out to the marketing landing page.
  // The shared isTeamEmail() helper makes both gates read the same
  // predicate from one place.
  if (!profile?.system_role && !isTeamEmail(user.email)) redirect('/')

  // AdminSidebar's permission-gated nav assumes one of two roles. For
  // a Team member without a provisioned system_role we render the
  // platform_support view — read-only-feeling, no Billing/Roles links.
  const sidebarRole: SystemRole = profile?.system_role ?? 'platform_support'

  // K3 — per-item sidebar gating. Resolve the caller's HQ-global role
  // permission bag (organization_id IS NULL, mirroring hqGate) so Billing and
  // Roles render only when granted. platform_owner short-circuits via
  // isSuperAdmin, covering Tyler (role_id NULL) without an assigned HQ role.
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
  const canManageBilling = isSuperAdmin(permProfile) || hasHqPermission(permProfile, 'manage_platform_billing')
  const canManageRoles   = isSuperAdmin(permProfile) || hasHqPermission(permProfile, 'manage_global_roles')

  return (
    <div className="flex h-full min-h-screen bg-pvx-bg text-slate-100">
      <AdminSidebar
        systemRole={sidebarRole}
        canManageBilling={canManageBilling}
        canManageRoles={canManageRoles}
      />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-center border-b border-pvx-border bg-pvx-bg/80 backdrop-blur px-8 py-3">
          <AdminGlobalSearch />
        </header>
        <div className="flex-1 px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
