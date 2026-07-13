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

  const supabase = await createClient()

  // K3 — the settings hub renders multiple tabs; reaching it requires ANY one
  // of the settings-scoped permissions (tabs self-gate in a later stage).
  // Preserves: impersonation grant (HQ admin acting as tenant) AND the
  // permission-bag check. The legacy role='admin' back-compat was dropped in
  // K2c-A (platform_owner Tyler reaches tenant pages only via impersonation).
  const { data: prof } = await supabase
    .from('profiles')
    .select('role_id, roles(permissions)')
    .eq('id', ctx.user.id)
    .maybeSingle<{ role_id: string | null; roles: { permissions: Record<string, boolean> | null } | null }>()
  const permissions = prof?.roles?.permissions ?? null

  const settingsKeys = ['manage_team','manage_roles','manage_org_support_settings','manage_lead_settings','manage_org_settings','manage_billing'] as const
  const hasAny = !!permissions && settingsKeys.some(k => permissions[k] === true)
  if (!ctx.impersonation.active && !hasAny) redirect('/')

  const effectiveOrgId = ctx.effectiveOrgId

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
          Configure your organization&apos;s branding and service-area geofence.
        </p>
      </div>

      <BrandingForm initialLogoUrl={org?.logo_url ?? null} />
      <GeofenceForm initial={geofence} />
    </div>
  )
}
