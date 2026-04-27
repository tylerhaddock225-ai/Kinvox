'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type Plan = 'free' | 'pro' | 'enterprise'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')
  return supabase
}

export async function updateOrganization(formData: FormData) {
  const id       = String(formData.get('id')       ?? '').trim()
  const name     = String(formData.get('name')     ?? '').trim()
  const vertical = String(formData.get('vertical') ?? '').trim()
  const plan     = String(formData.get('plan')     ?? '').trim() as Plan
  if (!id || !name) redirect('/admin-hq/organizations')

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({
      name,
      vertical: vertical || null,
      plan,
    })
    .eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
  redirect(`/admin-hq/organizations/${id}`)
}

export async function setOrgStatus(formData: FormData) {
  const id     = String(formData.get('id')     ?? '').trim()
  const status = String(formData.get('status') ?? '').trim()
  if (!id || !status) return

  const supabase = await requireAdmin()
  await supabase.from('organizations').update({ status }).eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
}

export async function archiveOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  revalidatePath('/admin-hq/organizations')
  redirect('/admin-hq/organizations')
}

export async function restoreOrganization(formData: FormData) {
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return

  const supabase = await requireAdmin()
  await supabase
    .from('organizations')
    .update({ deleted_at: null })
    .eq('id', id)

  revalidatePath(`/admin-hq/organizations/${id}`)
  revalidatePath('/admin-hq/organizations')
}

// Master kill switch for tenant signal capture. HQ-only — flips
// organizations.ai_listening_enabled, which is the boolean both
// /api/v1/signals/capture and /api/v1/signals/ingest gate on. When off,
// the capture route returns 'feature_disabled_by_organization' (403)
// and the ingest route excludes the org from fan-out.
//
// Returns a discriminated result so the client can revert an optimistic
// flip without involving the redirect dance — needed for snappy switch UX.
export async function updateCaptureStatus(
  orgId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    return { ok: false, error: 'Missing organization id' }
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, error: 'Invalid toggle state' }
  }

  const supabase = await requireAdmin()

  const { error } = await supabase
    .from('organizations')
    .update({ ai_listening_enabled: enabled })
    .eq('id', orgId)

  if (error) return { ok: false, error: error.message }

  // Bust the org detail server-render cache so a subsequent navigation
  // shows the new state authoritatively. The optimistic UI handles the
  // immediate visual flip.
  revalidatePath(`/admin-hq/organizations/${orgId}`)
  return { ok: true }
}

const MAX_RADIUS_MILES = 500

// HQ-gated geofence write. Target org comes from the hidden form field; the
// is_admin_hq() RPC in requireAdmin is the scope check. Redirects back to
// the org detail page with an error query string when validation fails so
// the form can surface it without needing its own action state plumbing.
export async function setOrgGeofence(formData: FormData) {
  const id        = String(formData.get('id')            ?? '').trim()
  const latRaw    = String(formData.get('latitude')      ?? '').trim()
  const lngRaw    = String(formData.get('longitude')     ?? '').trim()
  const radiusRaw = String(formData.get('signal_radius') ?? '').trim()
  if (!id) redirect('/admin-hq/organizations')

  const supabase = await requireAdmin()

  const latitude  = latRaw    === '' ? null : Number(latRaw)
  const longitude = lngRaw    === '' ? null : Number(lngRaw)
  const radius    = radiusRaw === '' ? null : Number(radiusRaw)

  const fail = (msg: string) =>
    redirect(`/admin-hq/organizations/${id}?tab=details&geofence_error=${encodeURIComponent(msg)}`)

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
    redirect(`/admin-hq/organizations/${id}?tab=details&geofence_error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath(`/admin-hq/organizations/${id}`)
  redirect(`/admin-hq/organizations/${id}?tab=details&geofence_saved=1`)
}
