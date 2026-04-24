import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import Sidebar from './Sidebar'

export default async function SidebarServer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return <Sidebar canViewLeads={true} />

  // Resolve impersonation FIRST so the sidebar's "current org" reflects
  // the merchant the HQ admin is acting as, not the admin's own (null)
  // tenant org. Without this, navigating /leads → Dashboard falls back
  // to "/" which sorting-hats platform_owners straight to /admin-hq,
  // kicking them out of the impersonation context.
  const impersonation = await resolveImpersonation()

  const [{ data: canView }, { data: profile }] = await Promise.all([
    supabase.rpc('auth_user_view_leads'),
    supabase
      .from('profiles')
      .select('organization_id, system_role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; system_role: 'platform_owner' | 'platform_support' | null }>(),
  ])

  // Effective org is whichever lens the caller is looking through.
  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null

  let orgName: string | null = null
  let orgSlug: string | null = null
  let pendingSignalCount = 0
  if (effectiveOrgId) {
    const [{ data: org }, { count }] = await Promise.all([
      supabase
        .from('organizations')
        .select('name, slug')
        .eq('id', effectiveOrgId)
        .single<{ name: string | null; slug: string | null }>(),
      // HEAD + count avoids shipping row data we don't render in the
      // sidebar. RLS already scopes to the effective org; the
      // organization_id filter is defense-in-depth.
      supabase
        .from('pending_signals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', effectiveOrgId)
        .eq('status', 'pending'),
    ])
    orgName = org?.name ?? null
    orgSlug = org?.slug ?? null
    pendingSignalCount = count ?? 0
  }

  const isHqAdmin = !!profile?.system_role

  return (
    <Sidebar
      canViewLeads={canView ?? true}
      orgName={orgName}
      orgSlug={orgSlug}
      isHqAdmin={isHqAdmin}
      pendingSignalCount={pendingSignalCount}
    />
  )
}
