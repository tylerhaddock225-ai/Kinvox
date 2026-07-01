'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import { PERMISSION_KEYS, type Permissions, type OrgPermissionKey } from '@/lib/permissions'
import { orgGate } from '@/lib/permissions/gates'
import { mintToken, ttlFromNow, TTL } from '@/lib/auth/tokens'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { renderTeamInviteEmail } from '@/lib/email/templates/team-invite'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type TeamActionState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// ── Shared auth helper ───────────────────────────────────────────────────────

// Impersonation + permission contract: every write in this file targets the
// EFFECTIVE org, never the caller's own profile.organization_id. orgGate grants
// an HQ admin "acting as" a tenant (via the kinvox_impersonate_id cookie →
// resolveEffectiveOrgId), otherwise checks the caller's permission bag for
// `permissionKey`.
async function requireAdmin(permissionKey: OrgPermissionKey) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return null

  const gate = await orgGate(supabase, user.id, orgId, permissionKey)
  if (!gate.ok) return null

  // Inviter display name for the team-invite email template. Fetched
  // separately because orgGate returns only a pass/fail.
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

// Org row shape needed to brand + route a team-invite email. Mirrors the
// columns inviteMember already selects from organizations.
type InviteOrgRow = {
  id:                                  string
  name:                                string
  inbound_email_tag:                   string | null
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
  verified_lead_email:                 string | null
  verified_lead_email_confirmed_at:    string | null
}

// Single dispatch path for team-invite emails — shared by inviteMember (first
// send) and resendInvite (token rotation). Builds the /invite/<token> URL,
// renders the branded template, and routes through the org's transactional
// sender with the same threading headers either way.
async function dispatchTeamInviteEmail(params: {
  org:         InviteOrgRow
  inviteId:    string
  inviterName: string | null
  roleName:    string | null
  email:       string
  token:       string
  expiresAt:   string
}): Promise<Awaited<ReturnType<typeof sendOrgTransactionalEmail>>> {
  const { org } = params

  // Same fallback pattern as claim.ts — a shared getAppBaseUrl() helper is a
  // backlog item, intentionally not extracted here.
  const appBase   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'
  const inviteUrl = `${appBase}/invite/${params.token}`

  const { subject, htmlBody, textBody } = renderTeamInviteEmail({
    orgName:     org.name,
    inviterName: params.inviterName,
    roleName:    params.roleName,
    inviteUrl,
    expiresAt:   new Date(params.expiresAt),
  })

  // Align with the ticket/lead reply wire format: route replies through the
  // org's plus-addressed support inbox, and carry synthetic threading headers
  // so the invite presents as a conversation rather than a bare cold message.
  const replyTo     = constructInboundEmailAddress(org.inbound_email_tag ?? null)
  const threadingId = `<invite-${params.inviteId}@kinvox.com>`

  return sendOrgTransactionalEmail({
    org: {
      id:                                  org.id,
      name:                                org.name,
      verified_support_email:              org.verified_support_email,
      verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
      verified_lead_email:                 org.verified_lead_email,
      verified_lead_email_confirmed_at:    org.verified_lead_email_confirmed_at,
    },
    to:       [params.email],
    subject,
    htmlBody,
    textBody,
    tag:      'team-invite',
    replyTo:  replyTo ?? undefined,
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function inviteMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin('manage_team')
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

  const { data: insertedInvite, error: insErr } = await admin
    .from('member_invitations')
    .insert({
      organization_id: ctx.orgId,
      email,
      full_name:       fullName,
      role_id:         roleId,
      token_hash:      tokenHash,
      expires_at:      expiresAt,
      invited_by:      ctx.userId,
    })
    .select('id')
    .single()
  if (insErr || !insertedInvite) {
    return { status: 'error', error: insErr?.message ?? 'Could not create invitation' }
  }

  // ── Branded dispatch via sendOrgTransactionalEmail ───────────────────────
  const { data: org } = await admin
    .from('organizations')
    .select('id, name, inbound_email_tag, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at')
    .eq('id', ctx.orgId)
    .single()
  if (!org) return { status: 'error', error: 'Organization not found' }

  const result = await dispatchTeamInviteEmail({
    org,
    inviteId:    insertedInvite.id,
    inviterName: ctx.inviterName,
    roleName,
    email,
    token,
    expiresAt,
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
  const ctx = await requireAdmin('manage_team')
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

// Remove a member from the org by DETACHING them: organization_id + role_id are
// nulled so the sorting hat routes them to /pending-invite on next login. We do
// NOT hard-delete the profile (would orphan auth.users / break owner FK) and we
// never touch auth.users. Self-removal and owner-removal are forbidden; both are
// enforced server-side and never trusted from the client.
export async function removeMember(formData: FormData): Promise<void> {
  const ctx = await requireAdmin('manage_team')
  if (!ctx) return

  const memberId = formData.get('member_id') as string
  if (!memberId) return

  // Self-guard: an admin can't remove their own membership.
  if (memberId === ctx.userId) return

  const admin = createAdminClient()

  // Owner-guard (authoritative): never detach the org owner.
  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', ctx.orgId)
    .single<{ owner_id: string | null }>()
  if (org?.owner_id === memberId) return

  // Detach. Org-scoped so a tampered member_id from another org no-ops.
  await admin.from('profiles')
    .update({ organization_id: null, role_id: null })
    .eq('id', memberId)
    .eq('organization_id', ctx.orgId)

  revalidatePath('/[orgSlug]/settings/team', 'page')
}

// Resend a pending invitation. The raw token is never stored (only token_hash),
// so a resend ROTATES the token: new raw → new hash, fresh expiry, then re-send
// through the shared dispatch path. No-ops if the invite isn't ours or has been
// accepted.
export async function resendInvite(formData: FormData): Promise<void> {
  const ctx = await requireAdmin('manage_team')
  if (!ctx) return

  const inviteId = formData.get('invite_id') as string
  if (!inviteId) return

  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('member_invitations')
    .select('id, email, full_name, role_id')
    .eq('id', inviteId)
    .eq('organization_id', ctx.orgId)
    .is('accepted_at', null)
    .single<{ id: string; email: string; full_name: string | null; role_id: string | null }>()
  if (!invite) return   // wrong org / already accepted → no-op

  // Rotate the token + bump expiry on the existing row.
  const { raw: token, hash: tokenHash } = mintToken()
  const expiresAt = ttlFromNow(TTL.MEMBER_INVITE)
  await admin
    .from('member_invitations')
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq('id', invite.id)
    .eq('organization_id', ctx.orgId)
    .is('accepted_at', null)

  // Role name for the email template (RLS-readable by org members via SSR client).
  let roleName: string | null = null
  if (invite.role_id) {
    const { data: role } = await ctx.supabase
      .from('roles')
      .select('name')
      .eq('id', invite.role_id)
      .maybeSingle<{ name: string }>()
    roleName = role?.name ?? null
  }

  const { data: org } = await admin
    .from('organizations')
    .select('id, name, inbound_email_tag, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at')
    .eq('id', ctx.orgId)
    .single<InviteOrgRow>()
  if (!org) return

  await dispatchTeamInviteEmail({
    org,
    inviteId:    invite.id,
    inviterName: ctx.inviterName,
    roleName,
    email:       invite.email,
    token,
    expiresAt,
  })

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
  const ctx = await requireAdmin('manage_roles')
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
  const ctx = await requireAdmin('manage_roles')
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
  const ctx = await requireAdmin('manage_roles')
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
