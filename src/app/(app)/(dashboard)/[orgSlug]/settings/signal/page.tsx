import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-context'
import HuntingProfileForm from './HuntingProfileForm'

export const dynamic = 'force-dynamic'

// Per-vertical "Searchlight" — where Kinvox listens for high-intent posts.
// Edits the tenant's primary signal_configs row (or inserts one keyed to
// the org's vertical if none exists). The same form previously shipped on
// /settings/integrations; KINV-013 moved it here so connectivity (OAuth)
// and signal hunting (geofence + keywords) are separate surfaces.
export default async function SignalSettingsPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login')
  if (!ctx.effectiveOrgId) redirect('/onboarding')
  if (!ctx.impersonation.active && ctx.profile.role !== 'admin') redirect('/')

  const supabase = await createClient()
  const [{ data: org }, { data: primaryConfig }] = await Promise.all([
    supabase
      .from('organizations')
      .select('vertical')
      .eq('id', ctx.effectiveOrgId)
      .single<{ vertical: string | null }>(),
    supabase
      .from('signal_configs')
      .select('id, office_address, radius_miles, keywords')
      .eq('organization_id', ctx.effectiveOrgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{
        id:             string
        office_address: string | null
        radius_miles:   number
        keywords:       string[]
      }>(),
  ])

  return (
    <div className="px-8 py-8 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Signal Settings</h1>
        <p className="text-sm text-gray-400 mt-1">
          Tune what Kinvox listens for. The hunting profile drives which
          posts land in your Signals queue — distinct from the org-level
          geofence on the main Settings page.
        </p>
      </div>

      <HuntingProfileForm
        orgVertical={org?.vertical ?? null}
        initialAddress={primaryConfig?.office_address ?? null}
        initialRadius={primaryConfig?.radius_miles ?? 25}
        initialKeywords={primaryConfig?.keywords ?? []}
      />
    </div>
  )
}
