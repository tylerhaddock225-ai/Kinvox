'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type State = { status: 'success' } | { status: 'error'; error: string } | null

export async function createAppointment(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization' }

  const title       = formData.get('title')       as string
  const description = formData.get('description') as string | null
  const start_at    = formData.get('start_at')    as string
  const end_at      = formData.get('end_at')      as string | null
  const location    = formData.get('location')    as string | null
  const assigned_to = formData.get('assigned_to') as string | null
  const lead_id     = formData.get('lead_id')     as string | null

  if (!title?.trim())  return { status: 'error', error: 'Title is required' }
  if (!start_at)       return { status: 'error', error: 'Start time is required' }

  const { error } = await supabase.from('appointments').insert({
    organization_id: profile.organization_id,
    created_by:  user.id,
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at   || null,
    location:    location || null,
    assigned_to: assigned_to || null,
    lead_id:     lead_id     || null,
    status:      'scheduled',
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/appointments')
  return { status: 'success' }
}

export async function deleteAppointment(appointmentId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('appointments').delete().eq('id', appointmentId)

  revalidatePath('/appointments')
}

export async function updateAppointment(
  appointmentId: string,
  _prev: State,
  formData: FormData,
): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const title       = formData.get('title')       as string
  const description = formData.get('description') as string | null
  const start_at    = formData.get('start_at')    as string
  const end_at      = formData.get('end_at')      as string | null
  const location    = formData.get('location')    as string | null
  const assigned_to = formData.get('assigned_to') as string | null
  const lead_id     = formData.get('lead_id')     as string | null

  if (!title?.trim()) return { status: 'error', error: 'Title is required' }
  if (!start_at)      return { status: 'error', error: 'Start time is required' }

  const { error } = await supabase.from('appointments').update({
    title:       title.trim(),
    description: description || null,
    start_at,
    end_at:      end_at      || null,
    location:    location    || null,
    assigned_to: assigned_to || null,
    lead_id:     lead_id     || null,
  }).eq('id', appointmentId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/appointments')
  return { status: 'success' }
}
