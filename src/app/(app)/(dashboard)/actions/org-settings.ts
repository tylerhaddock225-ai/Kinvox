'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId, resolveImpersonation } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import { createSenderSignature, getSenderSignatureByEmail } from '@/lib/postmark-admin'
import { generateInboundEmailTag } from '@/lib/org-utils'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

export type RefreshSupportEmailResult =
  | { status: 'success';   message: string }
  | { status: 'pending';   message: string }
  | { status: 'not_found'; message: string }
  | { status: 'error';     error: string }

export type RefreshLeadEmailResult =
  | { status: 'success';   message: string }
  | { status: 'pending';   message: string }
  | { status: 'not_found'; message: string }
  | { status: 'error';     error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Org Owner OR a system 'admin' role can edit support settings — and an HQ
// admin in "View as Merchant" mode always can, targeting the impersonated
// tenant. Returns { ok: true, orgId } or { ok: false, error } so callers
// can fail uniformly.
async function requireSettingsAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { ok: false as const, error: 'No organization' }

  // HQ admin impersonating has already cleared the is_admin_hq gate inside
  // resolveImpersonation; skip the owner/admin check so they can edit on
  // the tenant's behalf. Tenant callers still need owner or role='admin'.
  const impersonation = await resolveImpersonation()
  if (!impersonation.active) {
    const [{ data: profile }, { data: org }] = await Promise.all([
      supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single<{ role: string | null }>(),
      supabase
        .from('organizations')
        .select('owner_id')
        .eq('id', orgId)
        .single<{ owner_id: string }>(),
    ])

    if (!org) return { ok: false as const, error: 'Organization not found' }

    const isOwner      = org.owner_id === user.id
    const isSuperAdmin = profile?.role === 'admin'
    if (!isOwner && !isSuperAdmin) {
      return { ok: false as const, error: 'You do not have permission to change support settings' }
    }
  }

  return { ok: true as const, userId: user.id, orgId }
}

export async function updateSupportEmail(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const email = (formData.get('support_email') as string | null)?.trim() ?? ''
  if (!email) return { status: 'error', error: 'Support email is required' }
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Enter a valid email address' }

  // Pull the org name to use as the Sender Signature display name in Postmark.
  // Also pull the lead-channel email so we can reject same-address collisions —
  // each channel needs its own Postmark Sender Signature, so they MUST differ.
  const { data: org } = await supabase
    .from('organizations')
    .select('name, verified_lead_email')
    .eq('id', guard.orgId)
    .single<{ name: string; verified_lead_email: string | null }>()

  if (org?.verified_lead_email && email.toLowerCase() === org.verified_lead_email.toLowerCase()) {
    return { status: 'error', error: 'Support and lead notifications emails must be different — pick a separate address for each channel.' }
  }

  // a) Trigger the Postmark verification email. createSenderSignature now
  //    recovers gracefully on duplicates — if the signature already exists
  //    on Postmark's side, it returns the existing record so we can read
  //    its Confirmed flag and skip the verification round-trip.
  let signature
  try {
    signature = await createSenderSignature(email, org?.name ?? 'Kinvox Support')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to request verification'
    return { status: 'error', error: msg }
  }

  // b) Persist the new email. If Postmark already considers the signature
  //    Confirmed (re-saving an address that was previously verified), set
  //    confirmed_at = now() immediately so the user doesn't have to chase
  //    a verification email or hit Refresh. Otherwise null and wait.
  const confirmedAt = signature.Confirmed ? new Date().toISOString() : null
  const { error: updErr } = await supabase
    .from('organizations')
    .update({
      verified_support_email:              email,
      verified_support_email_confirmed_at: confirmedAt,
    })
    .eq('id', guard.orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: signature.Confirmed
      ? `${email} is already verified — saved.`
      : `Verification email sent to ${email}.`,
  }
}

export async function initializeInboundEmail(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { data: org } = await supabase
    .from('organizations')
    .select('name, inbound_email_tag')
    .eq('id', guard.orgId)
    .single<{ name: string; inbound_email_tag: string | null }>()

  if (!org) return { status: 'error', error: 'Organization not found' }
  if (org.inbound_email_tag) {
    // Already set — treat as success so the UI can refresh without an error toast.
    return { status: 'success', message: 'Inbound address already assigned.' }
  }

  // Retry a few times in case the random hash collides with the unique index.
  let lastError: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInboundEmailTag(org.name)
    const { error } = await supabase
      .from('organizations')
      .update({ inbound_email_tag: candidate })
      .eq('id', guard.orgId)
      .is('inbound_email_tag', null)   // only set if still unset (avoid clobber)

    if (!error) {
      revalidatePath('/[orgSlug]/settings/team', 'page')
      return { status: 'success', message: `Support inbound address is ready.` }
    }
    lastError = error.message
    // 23505 → unique violation; loop and try a fresh hash. Anything else: give up.
    if (!/duplicate key|23505|already exists/i.test(error.message)) break
  }

  return { status: 'error', error: lastError ?? 'Failed to generate inbound address' }
}

/**
 * Lead-channel parallel of `initializeInboundEmail`. Mints a tag for the
 * `inbound_lead_email_tag` column. The full plus-addressed email is
 * assembled at display/use time by `constructInboundEmailAddress`.
 */
export async function initializeLeadInboundEmail(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { data: org } = await supabase
    .from('organizations')
    .select('name, inbound_lead_email_tag')
    .eq('id', guard.orgId)
    .single<{ name: string; inbound_lead_email_tag: string | null }>()

  if (!org) return { status: 'error', error: 'Organization not found' }
  if (org.inbound_lead_email_tag) {
    return { status: 'success', message: 'Lead inbound address already assigned.' }
  }

  let lastError: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInboundEmailTag(org.name)
    const { error } = await supabase
      .from('organizations')
      .update({ inbound_lead_email_tag: candidate })
      .eq('id', guard.orgId)
      .is('inbound_lead_email_tag', null)

    if (!error) {
      revalidatePath('/[orgSlug]/settings/team', 'page')
      return { status: 'success', message: `Lead inbound address is ready.` }
    }
    lastError = error.message
    if (!/duplicate key|23505|already exists/i.test(error.message)) break
  }

  return { status: 'error', error: lastError ?? 'Failed to generate lead inbound address' }
}

/**
 * Reconcile the Organization's support-email confirmation status with
 * Postmark. There is no inbound webhook for sender-signature events
 * today, so this is the user-driven path: the org settings page exposes
 * a "Refresh status" button that calls this action.
 *
 * Looks up the signature by email via Postmark's Account API; if Postmark
 * reports it as Confirmed, flips verified_support_email_confirmed_at to
 * now(). Never touches verified_support_email itself — that's the user's
 * input, not ours to overwrite.
 *
 * Zero-Inference: org_id comes from session/impersonation via
 * requireSettingsAdmin. The action takes no arguments.
 */
export async function refreshSupportEmailStatus(): Promise<RefreshSupportEmailResult> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { data: org, error: readErr } = await supabase
    .from('organizations')
    .select('verified_support_email')
    .eq('id', guard.orgId)
    .single<{ verified_support_email: string | null }>()

  if (readErr) return { status: 'error', error: readErr.message }

  const supportEmail = org?.verified_support_email?.trim() ?? ''
  if (!supportEmail) {
    return { status: 'error', error: 'No support email configured' }
  }

  let signature
  try {
    signature = await getSenderSignatureByEmail(supportEmail)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to query Postmark'
    return { status: 'error', error: msg }
  }

  if (!signature) {
    return {
      status:  'not_found',
      message: 'No Postmark signature exists for this email — try Verify Email again',
    }
  }

  if (!signature.Confirmed) {
    return {
      status:  'pending',
      message: 'Still awaiting confirmation from Postmark',
    }
  }

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ verified_support_email_confirmed_at: new Date().toISOString() })
    .eq('id', guard.orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: `${supportEmail} is verified.` }
}

// ── Lead-notifications email channel ────────────────────────────────────
//
// Parallel pair of actions to updateSupportEmail / refreshSupportEmailStatus.
// Same shape, same Postmark plumbing — only the column targets differ:
// these write to verified_lead_email / verified_lead_email_confirmed_at.
//
// If a user sets the same address on both Lead Notifications AND Support
// Settings, createSenderSignature is called twice for the same email; the
// idempotent ErrorCode 504 fallback added in commit 9074172 catches the
// duplicate and returns the existing signature so we don't surface an
// error to the user.

export async function updateLeadEmail(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const email = (formData.get('lead_email') as string | null)?.trim() ?? ''
  if (!email) return { status: 'error', error: 'Lead notifications email is required' }
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Enter a valid email address' }

  // Same channel-split rule as `updateSupportEmail`: lead and support must
  // be different addresses (each gets its own Postmark Sender Signature).
  const { data: org } = await supabase
    .from('organizations')
    .select('name, verified_support_email')
    .eq('id', guard.orgId)
    .single<{ name: string; verified_support_email: string | null }>()

  if (org?.verified_support_email && email.toLowerCase() === org.verified_support_email.toLowerCase()) {
    return { status: 'error', error: 'Lead notifications and support emails must be different — pick a separate address for each channel.' }
  }

  let signature
  try {
    signature = await createSenderSignature(email, org?.name ?? 'Kinvox Lead Notifications')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to request verification'
    return { status: 'error', error: msg }
  }

  const confirmedAt = signature.Confirmed ? new Date().toISOString() : null
  const { error: updErr } = await supabase
    .from('organizations')
    .update({
      verified_lead_email:              email,
      verified_lead_email_confirmed_at: confirmedAt,
    })
    .eq('id', guard.orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: signature.Confirmed
      ? `${email} is already verified — saved.`
      : `Verification email sent to ${email}.`,
  }
}

/**
 * Reconcile the Organization's lead-notifications email confirmation
 * status with Postmark. Mirrors refreshSupportEmailStatus but targets the
 * verified_lead_email channel.
 */
export async function refreshLeadEmailStatus(): Promise<RefreshLeadEmailResult> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { data: org, error: readErr } = await supabase
    .from('organizations')
    .select('verified_lead_email')
    .eq('id', guard.orgId)
    .single<{ verified_lead_email: string | null }>()

  if (readErr) return { status: 'error', error: readErr.message }

  const leadEmail = org?.verified_lead_email?.trim() ?? ''
  if (!leadEmail) {
    return { status: 'error', error: 'No lead notifications email configured' }
  }

  let signature
  try {
    signature = await getSenderSignatureByEmail(leadEmail)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to query Postmark'
    return { status: 'error', error: msg }
  }

  if (!signature) {
    return {
      status:  'not_found',
      message: 'No Postmark signature exists for this email — try Verify Email again',
    }
  }

  if (!signature.Confirmed) {
    return {
      status:  'pending',
      message: 'Still awaiting confirmation from Postmark',
    }
  }

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ verified_lead_email_confirmed_at: new Date().toISOString() })
    .eq('id', guard.orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: `${leadEmail} is verified.` }
}
