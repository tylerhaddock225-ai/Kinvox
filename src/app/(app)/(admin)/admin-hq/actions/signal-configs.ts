'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function requireHqAdmin() {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')
  return supabase
}

function configsTab(orgId: string, extra = ''): string {
  const base = `/admin-hq/organizations/${orgId}?tab=signal-configs`
  return extra ? `${base}&${extra}` : base
}

// Keywords come off the form as a single comma-separated string — the
// geofence router stores them as text[], so we normalize both directions
// here rather than scattering split/trim logic across call sites.
function parseKeywords(raw: string): string[] {
  return raw
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0)
}

function parseNumeric(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export async function createSignalConfig(formData: FormData) {
  const supabase = await requireHqAdmin()

  const orgId    = String(formData.get('org_id')   ?? '').trim()
  const vertical = String(formData.get('vertical') ?? '').trim()
  if (!orgId)    redirect('/admin-hq/organizations')
  if (!vertical) redirect(configsTab(orgId, 'config_error=' + encodeURIComponent('Pick a vertical')))

  const centerLat    = parseNumeric(String(formData.get('center_lat')  ?? ''))
  const centerLong   = parseNumeric(String(formData.get('center_long') ?? ''))
  const radiusParsed = parseNumeric(String(formData.get('radius_miles') ?? ''))
  const radiusMiles  = radiusParsed !== null && radiusParsed > 0 ? Math.round(radiusParsed) : 50
  const keywords     = parseKeywords(String(formData.get('keywords') ?? ''))
  const isActive     = String(formData.get('is_active') ?? '') === 'on'

  const { error } = await supabase
    .from('signal_configs')
    .insert({
      organization_id: orgId,
      vertical,
      center_lat:  centerLat,
      center_long: centerLong,
      radius_miles: radiusMiles,
      keywords,
      is_active: isActive,
    })

  if (error) {
    redirect(configsTab(orgId, 'config_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirect(configsTab(orgId, 'config_saved=1'))
}

export async function updateSignalConfig(formData: FormData) {
  const supabase = await requireHqAdmin()

  const orgId    = String(formData.get('org_id')    ?? '').trim()
  const configId = String(formData.get('config_id') ?? '').trim()
  const vertical = String(formData.get('vertical')  ?? '').trim()
  if (!orgId || !configId) redirect('/admin-hq/organizations')
  if (!vertical) redirect(configsTab(orgId, 'config_error=' + encodeURIComponent('Pick a vertical')))

  const centerLat    = parseNumeric(String(formData.get('center_lat')   ?? ''))
  const centerLong   = parseNumeric(String(formData.get('center_long')  ?? ''))
  const radiusParsed = parseNumeric(String(formData.get('radius_miles') ?? ''))
  const radiusMiles  = radiusParsed !== null && radiusParsed > 0 ? Math.round(radiusParsed) : 50
  const keywords     = parseKeywords(String(formData.get('keywords') ?? ''))
  const isActive     = String(formData.get('is_active') ?? '') === 'on'

  const { error } = await supabase
    .from('signal_configs')
    .update({
      vertical,
      center_lat:  centerLat,
      center_long: centerLong,
      radius_miles: radiusMiles,
      keywords,
      is_active: isActive,
    })
    .eq('id', configId)
    .eq('organization_id', orgId)

  if (error) {
    redirect(configsTab(orgId, 'config_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirect(configsTab(orgId, 'config_saved=1'))
}

export async function deleteSignalConfig(formData: FormData) {
  const supabase = await requireHqAdmin()

  const orgId    = String(formData.get('org_id')    ?? '').trim()
  const configId = String(formData.get('config_id') ?? '').trim()
  if (!orgId || !configId) redirect('/admin-hq/organizations')

  const { error } = await supabase
    .from('signal_configs')
    .delete()
    .eq('id', configId)
    .eq('organization_id', orgId)

  if (error) {
    redirect(configsTab(orgId, 'config_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirect(configsTab(orgId, 'config_saved=1'))
}
