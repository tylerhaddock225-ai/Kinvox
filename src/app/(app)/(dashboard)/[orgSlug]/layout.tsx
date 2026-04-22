import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params:   Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const impersonation = await resolveImpersonation()
  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile.organization_id

  const { data: effectiveOrg } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', effectiveOrgId)
    .single<{ slug: string | null }>()

  if (!effectiveOrg?.slug || effectiveOrg.slug !== orgSlug) notFound()

  return <>{children}</>
}
