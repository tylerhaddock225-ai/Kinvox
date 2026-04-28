import { createClient } from '@/lib/supabase/server'
import SettingsTabs from './SettingsTabs'

export const dynamic = 'force-dynamic'

// The admin-hq layout already gates on system_role \u2014 no re-check needed here.
// Pull every setting this tab reads in one round trip and pluck by key client-side.
export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', ['ticket_id_prefix', 'show_affected_tab_field', 'show_record_id_field'])

  const byKey = new Map<string, unknown>((rows ?? []).map(r => [r.key, r.value]))

  const currentPrefix     = typeof byKey.get('ticket_id_prefix') === 'string' ? (byKey.get('ticket_id_prefix') as string) : 'tk_'
  const showAffectedTab   = byKey.get('show_affected_tab_field') === true
  const showRecordId      = byKey.get('show_record_id_field')    === true

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Configuration
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">
          Global knobs that apply to every organization on the platform.
        </p>
      </div>
      <SettingsTabs
        currentPrefix={currentPrefix}
        showAffectedTab={showAffectedTab}
        showRecordId={showRecordId}
      />
    </div>
  )
}
