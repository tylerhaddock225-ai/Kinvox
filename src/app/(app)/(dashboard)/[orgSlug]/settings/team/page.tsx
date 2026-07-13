import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgContext } from '@/lib/auth-context'
import { redirect } from 'next/navigation'
import TeamTabs from './TeamTabs'
import type { Permissions } from '@/lib/permissions'
import type { CatalogRow } from '@/lib/permissions/grouping'
import { normalizeLeadQuestions } from '@/lib/lead-questions'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'

// Base URL the lead-magnet URL row should render. Matches the HQ admin
// org page convention (NEXT_PUBLIC_APP_URL, prod-host fallback so a
// missing env var doesn't silently leak sandbox URLs).
const LANDING_BASE =
  (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com').replace(/\/$/, '')

export const dynamic = 'force-dynamic'

type SearchParams = {
  tab?: string
}

export type MemberRow = {
  id: string
  full_name: string | null
  email: string | null
  role_id: string | null
  role_name: string | null
}

export type RoleRow = {
  id: string
  name: string
  permissions: Permissions
  is_system_role: boolean
}

export type PendingInviteRow = {
  id: string
  email: string
  full_name: string | null
  role_id: string | null
  expires_at: string
  created_at: string
  expired: boolean
}

// Expiry resolved server-side (authoritative server clock, no client-time
// impurity). Module scope so it isn't subject to the React render-purity rules.
function isInviteExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now()
}

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp  = await searchParams
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.effectiveOrgId) redirect('/onboarding')

  const supabase = await createClient()

  // K3 — the Team tab specifically requires manage_team OR manage_roles.
  // An HQ admin who passed resolveImpersonation's is_admin_hq gate is treated
  // as a tenant admin on the impersonated org. The legacy role='admin' back-compat
  // was dropped in K2c-A; platform_owner Tyler reaches tenant pages via impersonation.
  const { data: prof } = await supabase
    .from('profiles')
    .select('role_id, roles(permissions)')
    .eq('id', ctx.user.id)
    .maybeSingle<{ role_id: string | null; roles: { permissions: Record<string, boolean> | null } | null }>()
  const permissions = prof?.roles?.permissions ?? null
  const hasTeamAccess = !!permissions && (permissions.manage_team === true || permissions.manage_roles === true)
  if (!ctx.impersonation.active && !hasTeamAccess) redirect('/')

  const orgId    = ctx.effectiveOrgId

  // Fetch members, roles, and the org settings row in parallel.
  const [membersRes, rolesRes, orgRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role_id, roles(id, name)')
      .eq('organization_id', orgId)
      .eq('is_org_inbox', false),
    supabase
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .eq('organization_id', orgId)
      .order('name'),
    supabase
      .from('organizations')
      .select('owner_id, inbound_email_tag, inbound_lead_email_tag, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at, custom_lead_questions, lead_magnet_settings, lead_magnet_slug')
      .eq('id', orgId)
      .single(),
  ])

  // Workstream L — permission_catalog grouping metadata for the Roles editor.
  // Public-read to authenticated (RLS: permission_catalog_select_authenticated).
  // Display-only; an empty/failed read falls back to the flat grid in TeamTabs.
  const { data: catalogRows } = await supabase
    .from('permission_catalog')
    .select('key, scope, group_slug, group_label, permission_label, description, action_tier, sort_order')
    .eq('scope', 'org')
    .order('sort_order')
  const permissionCatalog = (catalogRows ?? []) as CatalogRow[]
  if (permissionCatalog.length === 0) {
    console.warn('[team/settings] permission_catalog read empty — Roles grid falls back to flat rendering')
  }

  // Fetch emails via admin API
  const admin = createAdminClient()
  const emailMap: Record<string, string> = {}
  await Promise.all(
    (membersRes.data ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.id)
      if (data?.user?.email) emailMap[m.id] = data.user.email
    })
  )

  // Outstanding (unaccepted) member invitations for this org. Read via the
  // authenticated client — member_invitations SELECT RLS grants an Org Admin
  // (manage_team) their own org's invitations and an impersonating HQ admin
  // (is_admin_hq()) any org's; the organization_id filter scopes the org-agnostic
  // HQ policy to the effective org (orgId is the impersonation-aware effective org).
  const { data: pendingInvites } = await supabase
    .from('member_invitations')
    .select('id, email, full_name, role_id, expires_at, created_at')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    email: emailMap[m.id] ?? null,
    role_id: m.role_id,
    role_name: (m.roles as unknown as { name: string } | null)?.name ?? null,
  }))

  const roles: RoleRow[] = (rolesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissions as unknown as Permissions,
    is_system_role: r.is_system_role,
  }))

  // Resolve the per-channel tags into full inbound forwarding addresses
  // (<tag>@<POSTMARK_INBOUND_DOMAIN>) server-side. Client components never
  // see POSTMARK_INBOUND_DOMAIN.
  const supportInboundAddress = constructInboundEmailAddress(orgRes.data?.inbound_email_tag      ?? null)
  const leadInboundAddress    = constructInboundEmailAddress(orgRes.data?.inbound_lead_email_tag ?? null)

  const orgSettings = {
    inbound_email_address:               supportInboundAddress,
    verified_support_email:              orgRes.data?.verified_support_email              ?? null,
    verified_support_email_confirmed_at: orgRes.data?.verified_support_email_confirmed_at ?? null,
  }

  // The features bullet list is owned by the Organization (org-side editor)
  // post-Sprint-3; HQ no longer writes this key. Pull from the same jsonb
  // the public /l/[slug] page reads from so the UI is always in sync.
  const leadMagnetSettings = (orgRes.data?.lead_magnet_settings ?? null) as
    | { features?: unknown }
    | null
  const featuresRaw = leadMagnetSettings?.features
  const leadMagnetFeatures: string[] = Array.isArray(featuresRaw)
    ? featuresRaw.filter((f): f is string => typeof f === 'string')
    : []

  const leadSupport = {
    custom_lead_questions:            normalizeLeadQuestions(orgRes.data?.custom_lead_questions),
    lead_magnet_features:             leadMagnetFeatures,
    verified_lead_email:              orgRes.data?.verified_lead_email              ?? null,
    verified_lead_email_confirmed_at: orgRes.data?.verified_lead_email_confirmed_at ?? null,
    inbound_lead_email_address:       leadInboundAddress,
    lead_magnet_slug:                 orgRes.data?.lead_magnet_slug                 ?? null,
    landing_base:                     LANDING_BASE,
  }

  // Honor an explicit ?tab=… or fall back to the default 'users'.
  const initialTab =
    typeof sp.tab === 'string' && sp.tab.length > 0 ? sp.tab : undefined

  return (
    <div className="px-8 py-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Organization Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Manage your organization, team, and how customers reach you.
        </p>
      </div>
      <TeamTabs
        members={members}
        roles={roles}
        permissionCatalog={permissionCatalog}
        callerId={ctx.user.id}
        ownerId={orgRes.data?.owner_id ?? null}
        pendingInvites={(pendingInvites ?? []).map((inv) => ({
          ...inv,
          expired: isInviteExpired(inv.expires_at),
        }))}
        orgSettings={orgSettings}
        leadSupport={leadSupport}
        initialTab={initialTab}
      />
    </div>
  )
}
