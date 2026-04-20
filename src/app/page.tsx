import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

// Kinvox root — strict login-first entry. Unauthenticated requests
// leave immediately for /login; everything else is routed by the
// "sorting hat" below. No public / marketing surface is rendered here.
export default async function RootPage() {
  const supabase = await createClient()

  // ── Gate 0: authentication ─────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Gate 1: HQ impersonation override ──────────────────────
  // An HQ admin with an active impersonation cookie is viewing
  // a merchant's workspace; drop them into that org's dashboard.
  const impersonation = await resolveImpersonation()
  if (impersonation.active) {
    const { data: impOrg } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', impersonation.orgId)
      .single<{ slug: string | null }>()
    if (impOrg?.slug) redirect(`/${impOrg.slug}`)
  }

  // ── Sorting hat ────────────────────────────────────────────
  // One query covers all remaining branches: HQ role, merchant
  // org membership, and (via user_metadata) pending invites.
  const [{ data: isHq }, { data: profile }] = await Promise.all([
    supabase.rpc('is_admin_hq'),
    supabase
      .from('profiles')
      .select('organization_id, organizations(slug)')
      .eq('id', user.id)
      .single<{
        organization_id: string | null
        organizations: { slug: string | null } | null
      }>(),
  ])

  // 1. HQ admin → Command Center.
  if (isHq) redirect('/admin-hq')

  // 2. Merchant with an org → their workspace dashboard.
  //    NOTE: the dashboard route is /{slug} (see src/app/(dashboard)/[orgSlug]/page.tsx),
  //    not /{slug}/dashboard — there is no /dashboard sub-route.
  const slug = profile?.organizations?.slug
  if (profile?.organization_id && slug) redirect(`/${slug}`)

  // 3. Postmark invitee with a pending invite → accept screen.
  const hasInvite = Boolean(
    (user.user_metadata as { invited_to_org?: string } | null)?.invited_to_org
  )
  if (hasInvite) redirect('/onboarding')

  // 4. Orphan authenticated user → pending-invite (contact support).
  redirect('/pending-invite')
}
