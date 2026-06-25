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
  if (!ctx) {
    // TEMP-DIAG (revert after capture)
    console.error('[IMP-DIAG] orgSlug layout redirect ->', { to: '/login', reason: 'getOrgContext returned null (no auth)' })
    redirect('/login')
  }

  // TEMP-DIAG (revert after capture): tenant dashboard layout entry snapshot.
  console.error('[IMP-DIAG] orgSlug layout', {
    slug: orgSlug,
    rawOrgId: ctx.profile.organization_id,
    effectiveOrgId: ctx.effectiveOrgId,
    impersonationActive: ctx.impersonation.active,
    impersonationOrgId: ctx.impersonation.active ? ctx.impersonation.orgId : null,
  })

  if (!ctx.effectiveOrgId) {
    // TEMP-DIAG (revert after capture)
    console.error('[IMP-DIAG] orgSlug layout redirect ->', { to: '/onboarding', reason: 'effectiveOrgId is null/falsy' })
    redirect('/onboarding')
  }

  const supabase = await createClient()
  const { data: effectiveOrg } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', ctx.effectiveOrgId)
    .single<{ slug: string | null }>()

  if (!effectiveOrg?.slug || effectiveOrg.slug !== orgSlug) {
    // TEMP-DIAG (revert after capture)
    console.error('[IMP-DIAG] orgSlug layout notFound ->', { reason: 'slug mismatch', effectiveSlug: effectiveOrg?.slug ?? null, urlSlug: orgSlug })
    notFound()
  }

  return <>{children}</>
}
