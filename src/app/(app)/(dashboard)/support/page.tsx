import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

export const dynamic = 'force-dynamic'

// Legacy entry point: HQ support now lives at /[orgSlug]/hq-support for
// tenant-isolated URLs. Resolve the effective slug and bounce. Stale
// bookmarks, sidebar caches, and any lingering /support links keep working.
export default async function LegacySupportRedirect() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Guard on the impersonation-aware effective org (not the raw profile org)
  // so an org-less HQ admin impersonating a tenant isn't bounced to /onboarding.
  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single<{ organization_id: string | null }>(),
    resolveImpersonation(),
  ])

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  const orgId = effectiveOrgId

  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .single<{ slug: string | null }>()

  if (!org?.slug) notFound()

  redirect(`/${org.slug}/hq-support`)
}
