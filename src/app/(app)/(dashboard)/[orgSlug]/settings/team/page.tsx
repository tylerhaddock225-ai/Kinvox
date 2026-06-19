import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgContext } from '@/lib/auth-context'
import { redirect } from 'next/navigation'
import TeamTabs from './TeamTabs'
import type { Permissions } from '@/lib/permissions'
import { normalizeLeadQuestions } from '@/lib/lead-questions'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import type { CredentialRow } from './SocialConnectionsTab'

// Base URL the lead-magnet URL row should render. Matches the HQ admin
// org page convention (NEXT_PUBLIC_APP_URL, prod-host fallback so a
// missing env var doesn't silently leak sandbox URLs).
const LANDING_BASE =
  (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com').replace(/\/$/, '')

export const dynamic = 'force-dynamic'

type SearchParams = {
  tab?:    string
  reddit?: string
  detail?: string
}

export type MemberRow = {
  id: string
  full_name: string | null
  email: string | null
  system_role: 'admin' | 'agent' | 'viewer'
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
  // as a tenant admin on the impersonated org; legacy role='admin' tenants
  // (incl. platform_owner Tyler, role_id NULL) still pass via back-compat.
  const { data: prof } = await supabase
    .from('profiles')
    .select('role_id, roles(permissions)')
    .eq('id', ctx.user.id)
    .maybeSingle<{ role_id: string | null; roles: { permissions: Record<string, boolean> | null } | null }>()
  const permissions = prof?.roles?.permissions ?? null
  const hasTeamAccess = !!permissions && (permissions.manage_team === true || permissions.manage_roles === true)
  if (!ctx.impersonation.active && !hasTeamAccess && ctx.profile.role !== 'admin') redirect('/')

  const orgId    = ctx.effectiveOrgId

  // Fetch members, roles, the org settings row, primary signal_configs,
  // and the social credentials in parallel. signal_configs backs the
  // Signal Settings tab; organization_credentials backs Social Connections.
  // Column-level grants on organization_credentials hide secret_id from
  // authenticated callers, so this is safe to project narrowly.
  const [membersRes, rolesRes, orgRes, signalConfigRes, credsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, role_id, roles(id, name)')
      .eq('organization_id', orgId)
      .eq('is_org_inbox', false),
    supabase
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .eq('organization_id', orgId)
      .order('name'),
    supabase
      .from('organizations')
      .select('inbound_email_tag, inbound_lead_email_tag, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at, ai_listening_enabled, custom_lead_questions, signal_engagement_mode, vertical, lead_magnet_settings, lead_magnet_slug')
      .eq('id', orgId)
      .single(),
    supabase
      .from('signal_configs')
      .select('id, office_address, radius_miles, keywords')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{
        id:             string
        office_address: string | null
        radius_miles:   number
        keywords:       string[]
      }>(),
    supabase
      .from('organization_credentials')
      .select('platform, account_handle, status, expires_at')
      .eq('organization_id', orgId)
      .returns<CredentialRow[]>(),
  ])

  const { data: creditsRow } = await supabase
    .from('organization_credits')
    .select('balance')
    .eq('organization_id', orgId)
    .maybeSingle<{ balance: number }>()

  // Fetch emails via admin API
  const admin = createAdminClient()
  const emailMap: Record<string, string> = {}
  await Promise.all(
    (membersRes.data ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.id)
      if (data?.user?.email) emailMap[m.id] = data.user.email
    })
  )

  // Outstanding (unaccepted) member invitations for this org. Read via the admin
  // client: member_invitations SELECT RLS still keys on legacy auth_user_role()=
  // 'admin', so a permission-bag Org Admin (role='agent') couldn't see these via
  // the authenticated client. orgId is the impersonation-aware effective org.
  const { data: pendingInvites } = await admin
    .from('member_invitations')
    .select('id, email, full_name, role_id, expires_at, created_at')
    .eq('organization_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })

  const members: MemberRow[] = (membersRes.data ?? []).map((m) => ({
    id: m.id,
    full_name: m.full_name,
    email: emailMap[m.id] ?? null,
    system_role: m.role as MemberRow['system_role'],
    role_id: m.role_id,
    role_name: (m.roles as unknown as { name: string } | null)?.name ?? null,
  }))

  const roles: RoleRow[] = (rolesRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissions as unknown as Permissions,
    is_system_role: r.is_system_role,
  }))

  // Resolve the per-channel tags into full plus-addressed inbound emails
  // server-side. Client components never see POSTMARK_INBOUND_ADDRESS.
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

  // Workstream I: ai_listening_enabled, signal_engagement_mode, and balance
  // moved here from leadSupport so the Signal Settings tab owns the full
  // signal-capture control set (toggle + reply mode + credit balance +
  // hunting profile).
  const signalSettings = {
    ai_listening_enabled:   orgRes.data?.ai_listening_enabled                       ?? true,
    signal_engagement_mode: (orgRes.data?.signal_engagement_mode ?? 'ai_draft')     as 'ai_draft' | 'manual',
    balance:                creditsRow?.balance                                     ?? 0,
    orgVertical:            orgRes.data?.vertical                                   ?? null,
    initialAddress:         signalConfigRes.data?.office_address                    ?? null,
    initialRadius:          signalConfigRes.data?.radius_miles                      ?? 25,
    initialKeywords:        signalConfigRes.data?.keywords                          ?? [],
  }

  const credentials: CredentialRow[] = credsRes.data ?? []
  const socialBanner = {
    reddit: typeof sp.reddit === 'string' ? sp.reddit : undefined,
    detail: typeof sp.detail === 'string' ? sp.detail : undefined,
  }

  // OAuth callback redirects back here with ?reddit=connected — auto-select
  // the Social tab in that case so the success banner is visible. Otherwise
  // honor an explicit ?tab=… or fall back to the default 'users'.
  const initialTab =
    sp.reddit ? 'social'
              : (typeof sp.tab === 'string' && sp.tab.length > 0 ? sp.tab : undefined)

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
        pendingInvites={(pendingInvites ?? []).map((inv) => ({
          ...inv,
          expired: isInviteExpired(inv.expires_at),
        }))}
        orgSettings={orgSettings}
        leadSupport={leadSupport}
        signalSettings={signalSettings}
        credentials={credentials}
        socialBanner={socialBanner}
        initialTab={initialTab}
      />
    </div>
  )
}
