'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { orgGate } from '@/lib/permissions/gates'
import type { OrgPermissionKey } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'
import { createSenderSignature, getSenderSignatureByEmail } from '@/lib/postmark-admin'
import { buildInboundEmailTag } from '@/lib/org-utils'

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

// Permission gate for org email/inbound settings, routed through orgGate so HQ
// admins impersonating a tenant pass, and otherwise the caller's permission bag
// must grant `permissionKey`. Returns { ok: true, orgId } or { ok: false, error } so
// callers can fail uniformly.
async function requireSettingsAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  permissionKey: OrgPermissionKey,
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { ok: false as const, error: 'No organization' }

  const gate = await orgGate(supabase, user.id, orgId, permissionKey)
  if (!gate.ok) {
    return { ok: false as const, error: 'You do not have permission to change these settings' }
  }

  return { ok: true as const, userId: user.id, orgId }
}

// Auto-mint the per-tenant inbound forwarding tag on the moment an org's
// support or lead email is freshly verified. Stickiness: once minted the
// tag is never overwritten, so re-verifying or changing the verified
// email leaves the tag alone. Concurrent calls converge on the same
// candidate (deterministic from slug) and the loser becomes a no-op via
// the .is(column, null) predicate. Errors are logged, never thrown — the
// outer verify flow shouldn't fail because tag-mint hit a transient
// hiccup.
async function mintInboundTagIfMissing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  channel: 'support' | 'lead',
): Promise<void> {
  const column = channel === 'support' ? 'inbound_email_tag' : 'inbound_lead_email_tag'

  const { data: org, error: readErr } = await supabase
    .from('organizations')
    .select(`slug, ${column}`)
    .eq('id', orgId)
    .single()

  if (readErr || !org) {
    console.warn(`[mint-inbound-tag] org=${orgId} channel=${channel} read failed: ${readErr?.message ?? 'not found'}`)
    return
  }

  const row = org as Record<string, string | null>
  if (row[column]) return

  const slug = row.slug
  if (!slug) {
    console.warn(`[mint-inbound-tag] org=${orgId} has no slug — cannot mint ${channel} tag`)
    return
  }

  const newTag = buildInboundEmailTag(channel, slug)

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ [column]: newTag })
    .eq('id', orgId)
    .is(column, null)

  if (updErr) {
    console.warn(`[mint-inbound-tag] org=${orgId} channel=${channel} update failed: ${updErr.message}`)
    return
  }

  console.log(`[mint-inbound-tag] org=${orgId} channel=${channel} tag=${newTag}`)
}

export async function updateSupportEmail(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase, 'manage_org_support_settings')
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

  if (signature.Confirmed) {
    await mintInboundTagIfMissing(supabase, guard.orgId, 'support')
  }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: signature.Confirmed
      ? `${email} is already verified — saved.`
      : `Verification email sent to ${email}.`,
  }
}

// Legacy fallback: pre-Phase-A1 this drove a "Generate Address" button in
// Support Settings. Auto-mint on email verification has replaced that flow.
// Kept as a private safety net — the row-hide logic in InboundAddressRow
// no longer renders the button, so this is only reachable if a future UI
// change reintroduces a manual trigger. Stickiness is enforced inside
// mintInboundTagIfMissing.
export async function initializeInboundEmail(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase, 'manage_org_support_settings')
  if (!guard.ok) return { status: 'error', error: guard.error }

  await mintInboundTagIfMissing(supabase, guard.orgId, 'support')

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: 'Support inbound address is ready.' }
}

// Lead-channel parallel of initializeInboundEmail.
export async function initializeLeadInboundEmail(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase, 'manage_lead_settings')
  if (!guard.ok) return { status: 'error', error: guard.error }

  await mintInboundTagIfMissing(supabase, guard.orgId, 'lead')

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: 'Lead inbound address is ready.' }
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

  const guard = await requireSettingsAdmin(supabase, 'manage_org_support_settings')
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

  await mintInboundTagIfMissing(supabase, guard.orgId, 'support')

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

  const guard = await requireSettingsAdmin(supabase, 'manage_lead_settings')
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

  if (signature.Confirmed) {
    await mintInboundTagIfMissing(supabase, guard.orgId, 'lead')
  }

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

  const guard = await requireSettingsAdmin(supabase, 'manage_lead_settings')
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

  await mintInboundTagIfMissing(supabase, guard.orgId, 'lead')

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: `${leadEmail} is verified.` }
}
