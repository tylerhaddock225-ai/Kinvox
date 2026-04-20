import { redirect } from 'next/navigation'
import { unstable_noStore as noStore } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

// Opt out of every layer of render cache. Combined with the no-store
// Cache-Control header added in the middleware, the sorting hat below
// always executes against live session + database state — never a
// memoised snapshot from a prior request.
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Kinvox root — strict login-first entry. Unauthenticated requests
// leave immediately for /login; everything else is routed by the
// "sorting hat" below. No public / marketing surface is rendered here.
export default async function RootPage() {
  noStore()

  const supabase = await createClient()

  // ── Gate 0: authentication ─────────────────────────────────
  // getUser() re-validates the JWT against the Supabase auth server
  // on every call, picking up any role/metadata change from the DB.
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
  // Single profile read covers every remaining branch. Mirrors the
  // middleware / force-sync path — direct select beats the RPC pair
  // for staleness and plan-cache reasons documented there.
  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, organization_id, organizations(slug)')
    .eq('id', user.id)
    .single<{
      system_role: 'platform_owner' | 'platform_support' | null
      organization_id: string | null
      organizations: { slug: string | null } | null
    }>()

  // 1. HQ admin → Command Center.
  if (profile?.system_role) redirect('/admin-hq')

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
