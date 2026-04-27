import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-context'

export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params:   Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params

  // Cached: child pages calling getOrgContext() get the same result with
  // zero extra round-trips. The org slug check is the layout-only piece.
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.profile.organization_id) redirect('/onboarding')

  const supabase = await createClient()
  const { data: effectiveOrg } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', ctx.effectiveOrgId)
    .single<{ slug: string | null }>()

  if (!effectiveOrg?.slug || effectiveOrg.slug !== orgSlug) notFound()

  return <>{children}</>
}
