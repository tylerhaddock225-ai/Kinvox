import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgContext } from '@/lib/auth-context'
import { redirect } from 'next/navigation'
import TeamTabs from './TeamTabs'
import type { Permissions } from '@/lib/permissions'
import { normalizeLeadQuestions } from '@/lib/lead-questions'
import type { CredentialRow } from './SocialConnectionsTab'

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

export default async function TeamSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp  = await searchParams
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.effectiveOrgId) redirect('/onboarding')

  // An HQ admin who has passed resolveImpersonation's is_admin_hq gate
  // is treated as a tenant admin on the impersonated org for read
  // access; tenant role is only enforced when the caller is acting as
  // themselves.
  if (!ctx.impersonation.active && ctx.profile.role !== 'admin') redirect('/')

  const orgId    = ctx.effectiveOrgId
  const supabase = await createClient()

  // Fetch members, roles, the org settings row, primary signal_configs,
  // and the social credentials in parallel. signal_configs backs the
  // Signal Settings tab; organization_credentials backs Social Connections.
  // Column-level grants on organization_credentials hide secret_id from
  // authenticated callers, so this is safe to project narrowly.
  const [membersRes, rolesRes, orgRes, signalConfigRes, credsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, role_id, roles(id, name)')
      .eq('organization_id', orgId),
    supabase
      .from('roles')
      .select('id, name, permissions, is_system_role')
      .eq('organization_id', orgId)
      .order('name'),
    supabase
      .from('organizations')
      .select('inbound_email_address, verified_support_email, verified_support_email_confirmed_at, ai_listening_enabled, cancel_at_period_end, current_period_end, custom_lead_questions, signal_engagement_mode, vertical, lead_magnet_settings')
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

  const orgSettings = {
    inbound_email_address:               orgRes.data?.inbound_email_address               ?? null,
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
    ai_listening_enabled:   orgRes.data?.ai_listening_enabled   ?? true,
    balance:                creditsRow?.balance                 ?? 0,
    cancel_at_period_end:   orgRes.data?.cancel_at_period_end   ?? false,
    current_period_end:     orgRes.data?.current_period_end     ?? null,
    custom_lead_questions:  normalizeLeadQuestions(orgRes.data?.custom_lead_questions),
    lead_magnet_features:   leadMagnetFeatures,
    signal_engagement_mode: (orgRes.data?.signal_engagement_mode ?? 'ai_draft') as 'ai_draft' | 'manual',
  }

  const signalSettings = {
    orgVertical:     orgRes.data?.vertical                  ?? null,
    initialAddress:  signalConfigRes.data?.office_address   ?? null,
    initialRadius:   signalConfigRes.data?.radius_miles     ?? 25,
    initialKeywords: signalConfigRes.data?.keywords         ?? [],
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
