'use server'

import { createClient } from '@/lib/supabase/server'

export type AdminSearchHit =
  | { type: 'organization'; id: string }
  | { type: 'ticket';       id: string }
  | null

// Global search for the Admin HQ header bar. RLS is_admin_hq() lets the
// lookups cross orgs. Intentionally prefix-agnostic on the ticket branch so
// the configurable ticket_id_prefix in platform_settings keeps working (an
// HQ admin who changed the prefix to REQ- should still be able to paste
// REQ-42 here).
export async function adminGlobalSearch(query: string): Promise<AdminSearchHit> {
  const q = query.trim()
  if (!q) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Gate on system_role so anonymous-ish clients hitting this action don't
  // burn round-trips. RLS still enforces the final SELECT, but failing fast
  // keeps the error surface clean.
  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return null

  const lower = q.toLowerCase()

  // org_* matches the display_id added in 20260419223000.
  if (lower.startsWith('org_')) {
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('display_id', lower)
      .maybeSingle()
    return data ? { type: 'organization', id: data.id } : null
  }

  // Any other token: try as a ticket display_id (case-insensitive since
  // prefixes like REQ- are typically uppercase in config).
  const { data } = await supabase
    .from('tickets')
    .select('id')
    .ilike('display_id', q)
    .is('deleted_at', null)
    .maybeSingle()

  return data ? { type: 'ticket', id: data.id } : null
}
