'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId, resolveImpersonation } from '@/lib/impersonation'

export type SaveGeofenceState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

const MAX_RADIUS_MILES = 500

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

  revalidatePath('/settings')
  return { status: 'success' }
}
