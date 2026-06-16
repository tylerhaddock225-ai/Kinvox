'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId, requireTenantAdmin } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import { PERMISSION_KEYS, type Permissions } from '@/lib/permissions'
import { mintToken, ttlFromNow, TTL } from '@/lib/auth/tokens'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { renderTeamInviteEmail } from '@/lib/email/templates/team-invite'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type TeamActionState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// ── Shared auth helper ───────────────────────────────────────────────────────

// Impersonation contract (Hotfix #2 class — mirrors actions/appointments.ts):
// every write in this file targets the EFFECTIVE org, never the caller's own
// profile.organization_id. An HQ admin "acting as" a tenant (via the
// kinvox_impersonate_id cookie → resolveEffectiveOrgId) operates on the
// impersonated org; requireTenantAdmin() grants access on the impersonating
// branch and only enforces role === 'admin' when the caller is acting as
// themselves. Reading profile.organization_id directly here was the bug that
// misfiled invites/roles into the HQ admin's own org.
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return null

  const gate = await requireTenantAdmin(supabase, user.id, orgId)
  if (!gate.ok) return null

  // Inviter display name for the team-invite email template. Fetched
  // separately because requireTenantAdmin returns only a pass/fail.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single<{ full_name: string | null }>()

  return {
    supabase,
    orgId,
    userId:      user.id,
    inviterName: profile?.full_name ?? null,
  }
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function inviteMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const email    = String(formData.get('email') ?? '').trim().toLowerCase()
  const fullName = String(formData.get('full_name') ?? '').trim() || null
  const roleId   = (formData.get('role_id') as string) || null

  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Invalid email address' }

  const admin = createAdminClient()

  // Role name for the email template. Roles are RLS-readable by org members,
  // so the SSR client is fine. Tolerate a missing/renamed role.
  let roleName: string | null = null
  if (roleId) {
    const { data: role } = await ctx.supabase
      .from('roles')
      .select('name')
      .eq('id', roleId)
      .maybeSingle()
    roleName = role?.name ?? null
  }

  // ── Duplicate-member pre-flight ──────────────────────────────────────────
  // auth.users isn't reachable via PostgREST, so resolve email → user through
  // the GoTrue admin API (same pattern as api/auth/reset-password), then check
  // org membership on profiles.
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = userList?.users.find(u => u.email?.toLowerCase() === email)
  if (existingUser) {
    const { data: memberProfile } = await admin
      .from('profiles')
      .select('organization_id')
      .eq('id', existingUser.id)
      .maybeSingle()
    if (memberProfile?.organization_id === ctx.orgId) {
      return { status: 'error', error: 'This email is already a member of the organization' }
    }
  }

  // Active (un-accepted) invite already pending for this org + email?
  const { data: pending } = await admin
    .from('member_invitations')
    .select('id')
    .eq('organization_id', ctx.orgId)
    .eq('email', email)
    .is('accepted_at', null)
    .maybeSingle()
  if (pending) {
    return { status: 'error', error: 'An invitation is already pending for this email' }
  }

  // ── Mint + persist the invitation ────────────────────────────────────────
  const { raw: token, hash: tokenHash } = mintToken()
  const expiresAt = ttlFromNow(TTL.MEMBER_INVITE)

  const { error: insErr } = await admin.from('member_invitations').insert({
    organization_id: ctx.orgId,
    email,
    full_name:       fullName,
    role_id:         roleId,
    token_hash:      tokenHash,
    expires_at:      expiresAt,
    invited_by:      ctx.userId,
  })
  if (insErr) return { status: 'error', error: insErr.message }

  // ── Branded dispatch via sendOrgTransactionalEmail ───────────────────────
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at')
    .eq('id', ctx.orgId)
    .single()
  if (!org) return { status: 'error', error: 'Organization not found' }

  // Same fallback pattern as claim.ts — a shared getAppBaseUrl() helper is a
  // backlog item, intentionally not extracted here.
  const appBase   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'
  const inviteUrl = `${appBase}/invite/${token}`

  const { subject, htmlBody, textBody } = renderTeamInviteEmail({
    orgName:     org.name,
    inviterName: ctx.inviterName,
    roleName,
    inviteUrl,
    expiresAt:   new Date(expiresAt),
  })

  const result = await sendOrgTransactionalEmail({
    org: {
      id:                                  org.id,
      name:                                org.name,
      verified_support_email:              org.verified_support_email,
      verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
      verified_lead_email:                 org.verified_lead_email,
      verified_lead_email_confirmed_at:    org.verified_lead_email_confirmed_at,
    },
    to:       [email],
    subject,
    htmlBody,
    textBody,
    tag:      'team-invite',
  })
  if (!result.ok) {
    // Don't roll back the invitation row — the user can resend; the dead row
    // expires naturally.
    return { status: 'error', error: result.error }
  }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success' }
}

export async function updateMemberRole(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const memberId = formData.get('member_id') as string
  const roleId   = (formData.get('role_id') as string) || null

  const admin = createAdminClient()
  await admin.from('profiles')
    .update({ role_id: roleId })
    .eq('id', memberId)
    .eq('organization_id', ctx.orgId)

  revalidatePath('/[orgSlug]/settings/team', 'page')
}

// ── Roles ────────────────────────────────────────────────────────────────────

function parsePermissions(formData: FormData): Permissions {
  return Object.fromEntries(
    PERMISSION_KEYS.map(({ key }) => [key, formData.get(key) === 'on'])
  ) as Permissions
}

export async function createRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const name = (formData.get('name') as string).trim()
  if (!name) return { status: 'error', error: 'Role name is required' }

  const { error } = await ctx.supabase.from('roles').insert({
    organization_id: ctx.orgId,
    name,
    permissions: parsePermissions(formData),
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success' }
}

export async function updateRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const roleId = formData.get('role_id') as string
  const name   = (formData.get('name') as string).trim()
  if (!name) return { status: 'error', error: 'Role name is required' }

  const { error } = await ctx.supabase.from('roles')
    .update({ name, permissions: parsePermissions(formData) })
    .eq('id', roleId)
    .eq('organization_id', ctx.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success' }
}

// deleteRole stays a `void` server action because RolesPanel binds it via a
// plain `<form action={deleteRole}>` (no useActionState), whose typing only
// accepts a void/Promise<void> return. The system-role guard therefore blocks
// the delete by returning early rather than surfacing a TeamActionState the
// form could not consume anyway. See Stage 1c report — spec deviation #1.
export async function deleteRole(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const roleId = formData.get('role_id') as string

  // System roles (e.g. the auto-provisioned "Org Admin") can have their
  // permissions edited but never be deleted. updateRole intentionally stays
  // open so a later stage can backfill new permission keys onto them.
  const { data: target } = await ctx.supabase
    .from('roles')
    .select('is_system_role')
    .eq('id', roleId)
    .eq('organization_id', ctx.orgId)
    .maybeSingle<{ is_system_role: boolean }>()
  if (target?.is_system_role) {
    console.warn(`[deleteRole] blocked delete of system role=${roleId} org=${ctx.orgId}`)
    return
  }

  // Unassign anyone using this role before deleting
  await ctx.supabase.from('profiles')
    .update({ role_id: null })
    .eq('role_id', roleId)
    .eq('organization_id', ctx.orgId)

  await ctx.supabase.from('roles')
    .delete()
    .eq('id', roleId)
    .eq('organization_id', ctx.orgId)

  revalidatePath('/[orgSlug]/settings/team', 'page')
}
