import { createClient } from '@/lib/supabase/server'
import Sidebar from './Sidebar'

export default async function SidebarServer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return <Sidebar canViewLeads={true} />

  const [{ data: canView }, { data: profile }] = await Promise.all([
    supabase.rpc('auth_user_view_leads'),
    supabase
      .from('profiles')
      .select('organization_id, system_role')
      .eq('id', user.id)
      .single<{ organization_id: string | null; system_role: 'platform_owner' | 'platform_support' | null }>(),
  ])

  let orgName: string | null = null
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', profile.organization_id)
      .single()
    orgName = org?.name ?? null
  }

  const isHqAdmin = !!profile?.system_role

  return <Sidebar canViewLeads={canView ?? true} orgName={orgName} isHqAdmin={isHqAdmin} />
}
