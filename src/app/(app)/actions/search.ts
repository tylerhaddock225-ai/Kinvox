'use server'

import { createClient } from '@/lib/supabase/server'

export type SearchHit =
  | { type: 'lead';        id: string }
  | { type: 'appointment'; id: string; start_at: string }
  | { type: 'ticket';      id: string }
  | null

export async function globalSearch(query: string): Promise<SearchHit> {
  const q = query.trim().toLowerCase()
  if (!q) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (q.startsWith('ld_')) {
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('display_id', q)
      .is('deleted_at', null)
      .maybeSingle()
    return data ? { type: 'lead', id: data.id } : null
  }

  if (q.startsWith('ap_')) {
    const { data } = await supabase
      .from('appointments')
      .select('id, start_at')
      .eq('display_id', q)
      .is('deleted_at', null)
      .maybeSingle()
    if (!data) return null
    // Normalize to canonical ISO 8601 (Z) so the URL param round-trips cleanly.
    const isoStart = new Date(data.start_at).toISOString()
    return { type: 'appointment', id: data.id, start_at: isoStart }
  }

  if (q.startsWith('tk_')) {
    const { data } = await supabase
      .from('tickets')
      .select('id')
      .eq('display_id', q)
      .is('deleted_at', null)
      .maybeSingle()
    return data ? { type: 'ticket', id: data.id } : null
  }

  return null
}
