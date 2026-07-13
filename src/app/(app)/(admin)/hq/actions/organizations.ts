'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hqGate } from '@/lib/permissions/gates'
import type { HqPermissionKey } from '@/lib/permissions'

type Plan = 'free' | 'pro' | 'enterprise'

// K2b: routed through hqGate. The helper returns the Supabase client to its
// call sites, so on gate failure we preserve the helper's existing redirect
// contract rather than returning a Forbidden object that callers can't consume.
async function requireAdmin(permissionKey: HqPermissionKey) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const gate = await hqGate(supabase, user.id, permissionKey)
  if (!gate.ok) redirect('/login')
  return supabase
}

export async function updateOrganization(formData: FormData) {
  const id       = String(formData.get('id')       ?? '').trim()
  const name     = String(formData.get('name')     ?? '').trim()
  const vertical = String(formData.get('vertical') ?? '').trim()
  const plan     = String(formData.get('plan')     ?? '').trim() as Plan
  if (!id || !name) redirect('/hq/organizations')

  const supabase = await requireAdmin('manage_organizations')
  await supabase
    .from('organizations')
    .update({
      name,
      vertical: vertical || null,
      plan,
    })
    .eq('id', id)

  revalidatePath(`/hq/organizations/${id}`)
  revalidatePath('/hq/organizations')
  redirect(`/hq/organizations/${id}`)
}

export async function setOrgStatus(formData: FormData) {
  const id     = String(formData.get('id')     ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()
  if (!id || !status) return

  const supabase = await requireAdmin('manage_organizations')
  await supabase.from('organizations').update({ status }).eq('id', id)

  revalidatePath(`/hq/organizations/${id}`)
  revalidatePath('/hq/organizations')
}

export async function archiveOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin('manage_organizations')
  await supabase
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/hq/organizations')
  redirect('/hq/organizations')
}

export async function restoreOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin('manage_organizations')
  await supabase
    .from('organizations')
    .update({ deleted_at: null })
    .eq('id', id)

  revalidatePath(`/hq/organizations/${id}`)
  revalidatePath('/hq/organizations')
}

const MAX_RADIUS_MILES = 500

// HQ-gated geofence write. Target org comes from the hidden form field; the
// hqGate('manage_organizations') check in requireAdmin is the scope check.
// Redirects back to the org detail page with an error query string when
// validation fails so the form can surface it without its own state plumbing.
export async function setOrgGeofence(formData: FormData) {
  const id        = String(formData.get('id')            ?? '').trim()
  const latRaw    = String(formData.get('latitude')      ?? '').trim()
  const lngRaw    = String(formData.get('longitude')     ?? '').trim()
  const radiusRaw = String(formData.get('signal_radius') ?? '').trim()
  if (!id) redirect('/hq/organizations')

  const supabase = await requireAdmin('manage_organizations')

  const latitude  = latRaw    === '' ? null : Number(latRaw)
  const longitude = lngRaw    === '' ? null : Number(lngRaw)
  const radius    = radiusRaw === '' ? null : Number(radiusRaw)

  const fail = (msg: string) =>
    redirect(`/hq/organizations/${id}?tab=details&geofence_error=${encodeURIComponent(msg)}`)

  if ((latitude === null) !== (longitude === null)) {
    fail('Enter both latitude and longitude, or leave both blank')
  }
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    fail('Latitude must be between -90 and 90')
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    fail('Longitude must be between -180 and 180')
  }
  if (radius === null || !Number.isFinite(radius) || !Number.isInteger(radius) || radius < 1 || radius > MAX_RADIUS_MILES) {
    fail(`Signal radius must be a whole number between 1 and ${MAX_RADIUS_MILES} miles`)
  }

  const { error } = await supabase
    .from('organizations')
    .update({ latitude, longitude, signal_radius: radius })
    .eq('id', id)

  if (error) {
    redirect(`/hq/organizations/${id}?tab=details&geofence_error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/hq/organizations/${id}`)
  redirect(`/hq/organizations/${id}?tab=details&geofence_saved=1`)
}

// ── Owner management (HQ-only) ───────────────────────────────────────────────
// "Owner" is NOT a role or permission — it is the single organizations.owner_id
// slot. These write it directly; no migration/RLS is needed because the existing
// is_admin_hq() row-level UPDATE policy on organizations already covers owner_id.
// Bound in-form on the Members tab (setOrgOwner.bind(null, orgId, userId)), so
// the trailing FormData a form action passes is intentionally ignored.

// Set or transfer ownership. Same UPDATE covers first-set (owner_id was NULL)
// and transfer (owner_id was someone else). GUARDRAIL: the new owner must
// already be a non-bot member of THIS org — never a floating/other-org/bot
// account. Enforced server-side here, not just in the UI.
export async function setOrgOwner(organizationId: string, newOwnerUserId: string): Promise<void> {
  const orgId  = String(organizationId  ?? '').trim()
  const userId = String(newOwnerUserId ?? '').trim()
  if (!orgId || !userId) redirect('/hq/organizations')

  const supabase = await requireAdmin('manage_organizations')

  const fail = (msg: string) =>
    redirect(`/hq/organizations/${orgId}?tab=members&owner_error=${encodeURIComponent(msg)}`)

  // Same-org, non-bot membership guard. is_org_inbox IS NOT TRUE excludes the
  // per-org lead-inbox bot; organization_id ties the user to THIS org.
  const { data: member } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .eq('organization_id', orgId)
    .not('is_org_inbox', 'is', true)
    .maybeSingle<{ id: string }>()
  if (!member) fail('That user is not a member of this organization')

  const { error } = await supabase
    .from('organizations')
    .update({ owner_id: userId })
    .eq('id', orgId)
  if (error) fail(error.message)

  revalidatePath(`/hq/organizations/${orgId}`)
  revalidatePath('/hq/organizations')
  redirect(`/hq/organizations/${orgId}?tab=members&owner_saved=1`)
}

// Remove a NON-OWNER member from a tenant org by DETACHING them — nulling
// organization_id + role_id, keeping the auth.users + profiles row (reversible:
// a re-invite restores membership; authorship is untouched). Mirrors the org-side
// removeMember / HQ removeHqUser detach pattern. NOT a hard delete of auth.users.
export async function removeOrgMember(organizationId: string, memberUserId: string): Promise<void> {
  const orgId  = String(organizationId ?? '').trim()
  const userId = String(memberUserId  ?? '').trim()
  if (!orgId || !userId) redirect('/hq/organizations')

  // HQ gate (redirects on failure); the detach itself runs through the admin
  // client below, exactly like the org-side removeMember.
  await requireAdmin('manage_organizations')

  const fail = (msg: string) =>
    redirect(`/hq/organizations/${orgId}?tab=members&member_error=${encodeURIComponent(msg)}`)

  const admin = createAdminClient()

  // GUARDRAIL 1 — owner-refusal (authoritative, server-read): never detach the
  // person while they still hold the owner_id slot. Clear ownership first.
  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .single<{ owner_id: string | null }>()
  if (org?.owner_id === userId) {
    fail('Remove this user as owner before removing them from the organization.')
  }

  // DETACH (not a hard delete). Org-scoped so a tampered id from another org
  // no-ops; is_org_inbox IS NOT TRUE excludes the per-org lead-inbox bot
  // (GUARDRAIL 2, belt-and-suspenders — the bot is never given a remove control).
  const { error } = await admin
    .from('profiles')
    .update({ organization_id: null, role_id: null })
    .eq('id', userId)
    .eq('organization_id', orgId)
    .not('is_org_inbox', 'is', true)
  if (error) fail(error.message)

  revalidatePath(`/hq/organizations/${orgId}`)
  revalidatePath('/hq/organizations')
  redirect(`/hq/organizations/${orgId}?tab=members&member_removed=1`)
}

// Clear the owner slot only. The org becomes ownerless (valid post-W1); the
// person stays a normal member — this does NOT detach or delete them (that is
// Stage 3, a separate action).
export async function removeOrgOwner(organizationId: string): Promise<void> {
  const orgId = String(organizationId ?? '').trim()
  if (!orgId) redirect('/hq/organizations')

  const supabase = await requireAdmin('manage_organizations')

  const { error } = await supabase
    .from('organizations')
    .update({ owner_id: null })
    .eq('id', orgId)
  if (error) {
    redirect(`/hq/organizations/${orgId}?tab=members&owner_error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/hq/organizations/${orgId}`)
  revalidatePath('/hq/organizations')
  redirect(`/hq/organizations/${orgId}?tab=members&owner_saved=1`)
}
