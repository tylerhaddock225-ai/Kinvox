import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-context'
import GeofenceForm from './GeofenceForm'
import BrandingForm from './BrandingForm'

export const dynamic = 'force-dynamic'

export type GeofenceRow = {
  latitude:      number | null
  longitude:     number | null
  signal_radius: number | null
}

type OrgSettingsRow = GeofenceRow & { logo_url: string | null }

export default async function SettingsPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.effectiveOrgId) redirect('/onboarding')

  // Mirror /settings/team: HQ admin impersonating passes the is_admin_hq
  // gate inside resolveImpersonation; a tenant user must have role='admin'.
  if (!ctx.impersonation.active && ctx.profile.role !== 'admin') redirect('/')

  const effectiveOrgId = ctx.effectiveOrgId
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('latitude, longitude, signal_radius, logo_url')
    .eq('id', effectiveOrgId)
    .single<OrgSettingsRow>()

  const geofence: GeofenceRow = {
    latitude:      org?.latitude      ?? null,
    longitude:     org?.longitude     ?? null,
    signal_radius: org?.signal_radius ?? 25,
  }

  return (
    <div className="px-8 py-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Organization Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Configure your organization's branding and where it listens for signals.
        </p>
      </div>

      <BrandingForm initialLogoUrl={org?.logo_url ?? null} />
      <GeofenceForm initial={geofence} />
    </div>
  )
}
