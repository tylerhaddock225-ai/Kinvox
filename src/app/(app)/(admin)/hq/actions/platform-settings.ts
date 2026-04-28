'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type State = { status: 'success'; message?: string } | { status: 'error'; error: string } | null

// Loose allowlist for the ticket ID prefix. Keeps config free-form enough for
// real-world prefixes (tk_, REQ-, INC-, SUP_) while blocking injection vectors
// like whitespace, SQL quotes, or anything that'd corrupt the display_id.
const PREFIX_RE = /^[A-Za-z][A-Za-z0-9_-]{0,11}$/

const TOGGLE_KEYS = ['show_affected_tab_field', 'show_record_id_field'] as const
type ToggleKey = typeof TOGGLE_KEYS[number]

export async function updateTicketIdPrefix(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return { status: 'error', error: 'Not authorized' }

  const rawPrefix = (formData.get('ticket_id_prefix') as string | null) ?? ''
  const prefix = rawPrefix.trim()

  if (!prefix) return { status: 'error', error: 'Prefix is required' }
  if (!PREFIX_RE.test(prefix)) {
    return { status: 'error', error: 'Use 1–12 chars starting with a letter (letters, digits, _ or -).' }
  }

  const { error } = await supabase
    .from('platform_settings')
    .upsert({
      key:        'ticket_id_prefix',
      value:      prefix,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/hq/settings')
  return { status: 'success', message: `Saved — new tickets will use "${prefix}123".` }
}

// Generic boolean toggle writer used by the Support Settings checkboxes.
// Auto-submits from each checkbox (no explicit Save button) to match the
// inline MemberRoleSelect pattern in team settings.
export async function updatePlatformToggle(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return

  const key = formData.get('key') as string | null
  if (!key || !TOGGLE_KEYS.includes(key as ToggleKey)) return

  // Checkbox emits "on" when checked, nothing when unchecked.
  const value = formData.get('value') === 'on'

  await supabase
    .from('platform_settings')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })

  revalidatePath('/hq/settings')
}
