'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId, resolveImpersonation } from '@/lib/impersonation'

export type SaveGeofenceState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export type UploadLogoState =
  | { status: 'success'; logo_url: string }
  | { status: 'error'; error: string }
  | null

const MAX_RADIUS_MILES = 50

const LOGO_BUCKET     = 'organization-assets'
const LOGO_MAX_BYTES  = 2 * 1024 * 1024
const LOGO_MIME_TO_EXT: Record<string, 'png' | 'jpg'> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
}

// Tenant-side geofence mutation. Uses resolveEffectiveOrgId so an HQ admin
// in "View as Merchant" writes into the impersonated tenant, not their own
// home org. Role gate: HQ admin impersonating OR tenant owner/admin.
export async function saveGeofence(
  _prev: SaveGeofenceState,
  formData: FormData,
): Promise<SaveGeofenceState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const impersonation = await resolveImpersonation()
  if (!impersonation.active) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single<{ role: string | null }>()

    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', orgId)
      .single<{ owner_id: string }>()

    const isOwner = org?.owner_id === user.id
    const isAdmin = profile?.role === 'admin'
    if (!isOwner && !isAdmin) {
      return { status: 'error', error: 'You do not have permission to change the geofence' }
    }
  }

  const latRaw    = String(formData.get('latitude')      ?? '').trim()
  const lngRaw    = String(formData.get('longitude')     ?? '').trim()
  const radiusRaw = String(formData.get('signal_radius') ?? '').trim()

  const latitude  = latRaw    === '' ? null : Number(latRaw)
  const longitude = lngRaw    === '' ? null : Number(lngRaw)
  const radius    = radiusRaw === '' ? null : Number(radiusRaw)

  // Lat/long can both be cleared together (no location set), but if one is
  // provided the other must be too — a half-set point is never valid.
  if ((latitude === null) !== (longitude === null)) {
    return { status: 'error', error: 'Enter both latitude and longitude, or leave both blank' }
  }
  if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return { status: 'error', error: 'Latitude must be between -90 and 90' }
  }
  if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    return { status: 'error', error: 'Longitude must be between -180 and 180' }
  }
  if (radius === null || !Number.isFinite(radius) || !Number.isInteger(radius) || radius < 1 || radius > MAX_RADIUS_MILES) {
    return { status: 'error', error: `Signal radius must be a whole number between 1 and ${MAX_RADIUS_MILES} miles` }
  }

  const { error } = await supabase
    .from('organizations')
    .update({ latitude, longitude, signal_radius: radius })
    .eq('id', orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings', 'page')
  return { status: 'success' }
}

// Branding logo upload. Same role gate as saveGeofence: HQ admin impersonating
// OR tenant owner / role='admin'. The upload path is built from the
// session-derived org id (Zero-Inference) — never from the form payload —
// so a tenant cannot overwrite another tenant's logo by tampering with input.
//
// Privacy Guard: the path is `logos/<org_uuid>/logo.<ext>`. The org UUID is a
// surrogate key, not PII, and the filename is fixed. No email, name, or other
// identifying string is ever written to the bucket.
export async function uploadOrgLogo(
  _prev: UploadLogoState,
  formData: FormData,
): Promise<UploadLogoState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const impersonation = await resolveImpersonation()
  if (!impersonation.active) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single<{ role: string | null }>()

    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id')
      .eq('id', orgId)
      .single<{ owner_id: string }>()

    const isOwner = org?.owner_id === user.id
    const isAdmin = profile?.role === 'admin'
    if (!isOwner && !isAdmin) {
      return { status: 'error', error: 'You do not have permission to change branding' }
    }
  }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', error: 'Choose a logo image to upload' }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return { status: 'error', error: 'Logo must be 2MB or smaller' }
  }
  const ext = LOGO_MIME_TO_EXT[file.type]
  if (!ext) {
    return { status: 'error', error: 'Logo must be a PNG or JPG image' }
  }

  // Service-role client: bypasses RLS so an HQ admin impersonating can write
  // into a tenant's path even though their JWT's auth_user_org_id() points
  // at HQ. Authorization is enforced above by the role gate.
  const admin = createAdminClient()
  const objectPath = `logos/${orgId}/logo.${ext}`

  const { error: uploadErr } = await admin.storage
    .from(LOGO_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadErr) return { status: 'error', error: uploadErr.message }

  // If the user previously uploaded the other format (e.g. logo.png) and is
  // now uploading logo.jpg, the old file would still serve. Best-effort
  // cleanup — ignore failure.
  const otherExt = ext === 'png' ? 'jpg' : 'png'
  await admin.storage.from(LOGO_BUCKET).remove([`logos/${orgId}/logo.${otherExt}`])

  const { data: publicUrlData } = admin.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(objectPath)

  // Cache-bust so the browser doesn't keep serving the prior logo bytes from
  // a CDN edge after re-upload to the same path.
  const cacheBustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`

  const { error: updErr } = await supabase
    .from('organizations')
    .update({ logo_url: cacheBustedUrl })
    .eq('id', orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  revalidatePath('/[orgSlug]/settings', 'page')
  return { status: 'success', logo_url: cacheBustedUrl }
}
