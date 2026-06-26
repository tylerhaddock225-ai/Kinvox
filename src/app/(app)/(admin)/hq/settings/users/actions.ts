'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hqGate } from '@/lib/permissions/gates'
import { mintToken, ttlFromNow, TTL } from '@/lib/auth/tokens'
import { sendPlatformEmail } from '@/lib/email/send-platform-email'
import { renderHqInviteEmail } from '@/lib/email/templates/hq-invite'
import { SYSTEM_ROLES, type SystemRole } from '@/lib/types/auth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Reject arbitrary strings before they reach the hq_invitations.system_role enum
// column. SYSTEM_ROLES is the single source of truth (@/lib/types/auth).
function isInternalRole(v: string): v is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(v)
}

export type HqInviteState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// Same fallback pattern as the tenant flow / claim.ts — a shared getAppBaseUrl()
// is a backlog item, intentionally not extracted here.
const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com').replace(/\/$/, '')

type AdminClient = ReturnType<typeof createAdminClient>

// HQ permission gate. The platform parallel of the tenant team-actions
// requireAdmin, but keys on hqGate('manage_users') — HQ authority, no org.
// Returns the inviter context or null (fail-closed).
async function requireHqAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const gate = await hqGate(supabase, user.id, 'manage_users')
  if (!gate.ok) return null

  // Inviter display name for the invite email template.
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single<{ full_name: string | null }>()

  return { userId: user.id, inviterName: profile?.full_name ?? null }
}

async function resolveRoleName(admin: AdminClient, roleId: string | null): Promise<string | null> {
  if (!roleId) return null
  const { data } = await admin
    .from('roles')
    .select('name')
    .eq('id', roleId)
    .maybeSingle<{ name: string }>()
  return data?.name ?? null
}

// Single dispatch path for HQ invite emails — shared by inviteHqUser (first send)
// and resendHqInvite (token rotation). Builds the /hq-invite/<token> URL, renders
// the Kinvox-branded template, and routes through sendPlatformEmail (platform
// sender — no org context).
async function dispatchHqInviteEmail(params: {
  inviteId:    string
  inviterName: string | null
  roleName:    string | null
  email:       string
  token:       string
  expiresAt:   string
}) {
  const { subject, htmlBody, textBody } = renderHqInviteEmail({
    inviterName: params.inviterName,
    roleName:    params.roleName,
    inviteUrl:   `${APP_BASE}/hq-invite/${params.token}`,
    expiresAt:   new Date(params.expiresAt),
  })

  const threadingId = `<hq-invite-${params.inviteId}@kinvox.com>`
  return sendPlatformEmail({
    to:      [params.email],
    subject,
    htmlBody,
    textBody,
    tag:     'hq-invite',
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })
}

// Invite a new HQ user. Gated on hqGate('manage_users'). Mints a hashed,
// single-use token into hq_invitations (org-less by table design) and dispatches
// the redeem link. The actual system_role write happens at redeem time, not here.
export async function inviteHqUser(input: {
  email:       string
  full_name?:  string | null
  system_role: string
  role_id?:    string | null
}): Promise<HqInviteState> {
  const ctx = await requireHqAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Invalid email address' }

  if (!isInternalRole(input.system_role)) {
    return { status: 'error', error: 'Invalid HQ role' }
  }
  const systemRole = input.system_role
  const fullName   = input.full_name?.trim() || null
  const roleId     = input.role_id || null

  const admin = createAdminClient()

  // ── Duplicate pre-flight ─────────────────────────────────────────────────
  // auth.users isn't reachable via PostgREST, so resolve email → user through
  // the GoTrue admin API (same pattern as inviteMember), then check the profile
  // against the HQ (org-null) invariant.
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = userList?.users.find(u => u.email?.toLowerCase() === email)
  if (existingUser) {
    const { data: prof } = await admin
      .from('profiles')
      .select('system_role, organization_id')
      .eq('id', existingUser.id)
      .maybeSingle<{ system_role: string | null; organization_id: string | null }>()
    if (prof?.system_role) {
      return { status: 'error', error: 'This email is already an HQ user' }
    }
    if (prof?.organization_id) {
      return { status: 'error', error: 'This email belongs to a tenant organization and cannot be provisioned as HQ staff' }
    }
  }

  // Active (un-accepted) HQ invite already pending for this email?
  const { data: pending } = await admin
    .from('hq_invitations')
    .select('id')
    .eq('email', email)
    .is('accepted_at', null)
    .maybeSingle()
  if (pending) {
    return { status: 'error', error: 'An HQ invitation is already pending for this email' }
  }

  // ── Mint + persist the invitation ────────────────────────────────────────
  // Admin (service-role) client mirrors inviteMember: the RLS insert policy is
  // is_admin_hq() with check, which the caller satisfies, but the admin client
  // keeps the insert path identical to the tenant flow and robust to gate drift.
  const { raw: token, hash: tokenHash } = mintToken()
  const expiresAt = ttlFromNow(TTL.HQ_INVITE)

  const { data: inserted, error: insErr } = await admin
    .from('hq_invitations')
    .insert({
      email,
      full_name:   fullName,
      system_role: systemRole,
      role_id:     roleId,
      token_hash:  tokenHash,
      expires_at:  expiresAt,
      invited_by:  ctx.userId,
    })
    .select('id')
    .single<{ id: string }>()
  if (insErr || !inserted) {
    return { status: 'error', error: insErr?.message ?? 'Could not create invitation' }
  }

  const roleName = await resolveRoleName(admin, roleId)
  const result = await dispatchHqInviteEmail({
    inviteId:    inserted.id,
    inviterName: ctx.inviterName,
    roleName,
    email,
    token,
    expiresAt,
  })
  if (!result.ok) {
    // Don't roll back the invitation row — it can be resent; the dead row
    // expires naturally.
    return { status: 'error', error: result.error }
  }

  revalidatePath('/hq/settings/users', 'page')
  return { status: 'success' }
}

// Rotate the token on an existing pending HQ invitation and re-dispatch. The raw
// token is unrecoverable (only the hash is stored), so resend mints a fresh one —
// exactly like the tenant resendInvite.
export async function resendHqInvite(invitationId: string): Promise<void> {
  const ctx = await requireHqAdmin()
  if (!ctx) return
  if (!invitationId) return

  const admin = createAdminClient()

  const { data: invite } = await admin
    .from('hq_invitations')
    .select('id, email, role_id')
    .eq('id', invitationId)
    .is('accepted_at', null)
    .single<{ id: string; email: string; role_id: string | null }>()
  if (!invite) return   // already accepted / unknown → no-op

  // Rotate the token + bump expiry on the existing row.
  const { raw: token, hash: tokenHash } = mintToken()
  const expiresAt = ttlFromNow(TTL.HQ_INVITE)
  await admin
    .from('hq_invitations')
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq('id', invite.id)
    .is('accepted_at', null)

  const roleName = await resolveRoleName(admin, invite.role_id)
  await dispatchHqInviteEmail({
    inviteId:    invite.id,
    inviterName: ctx.inviterName,
    roleName,
    email:       invite.email,
    token,
    expiresAt,
  })

  revalidatePath('/hq/settings/users', 'page')
}
