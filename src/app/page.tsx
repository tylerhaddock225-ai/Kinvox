import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

/**
 * Root landing. Smart-routes on role + impersonation state:
 *   1. Impersonating (cookie set + admin verified) → merchant view of that org.
 *   2. HQ admin (non-impersonating) → Command Center.
 *   3. Merchant → own org's slug dashboard.
 *   4. Pending Postmark invite → /onboarding (accept screen).
 *   5. Otherwise → /pending-invite (contact support).
 */
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const impersonation = await resolveImpersonation()
  if (impersonation.active) {
    const { data: org } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', impersonation.orgId)
      .single<{ slug: string | null }>()
    if (org?.slug) redirect(`/${org.slug}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, organizations(slug)')
    .eq('id', user.id)
    .single<{
      system_role: 'platform_owner' | 'platform_support' | null
      organizations: { slug: string | null } | null
    }>()

  if (profile?.system_role) redirect('/admin-hq')

  const slug = profile?.organizations?.slug
  if (slug) redirect(`/${slug}`)

  const hasInvite = Boolean(
    (user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
  )
  redirect(hasInvite ? '/onboarding' : '/pending-invite')
}
