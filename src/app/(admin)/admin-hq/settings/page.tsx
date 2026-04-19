import { createClient } from '@/lib/supabase/server'
import SettingsTabs from './SettingsTabs'

export const dynamic = 'force-dynamic'

// The admin-hq layout already gates on system_role — no re-check needed here.
// We do fetch the current prefix so the Support Settings form pre-fills.
export default async function AdminSettingsPage() {
  const supabase = await createClient()

  const { data: prefixRow } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'ticket_id_prefix')
    .maybeSingle()

  const currentPrefix = typeof prefixRow?.value === 'string' ? prefixRow.value : 'tk_'

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Platform Configuration
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">
          Global knobs that apply to every merchant on the platform.
        </p>
      </div>
      <SettingsTabs currentPrefix={currentPrefix} />
    </div>
  )
}
