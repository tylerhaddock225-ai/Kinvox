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

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) redirect('/onboarding')

  const impersonation = await resolveImpersonation()
  const orgId = impersonation.active ? impersonation.orgId : profile.organization_id

  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .single<{ slug: string | null }>()

  if (!org?.slug) notFound()

  redirect(`/${org.slug}/hq-support`)
}
