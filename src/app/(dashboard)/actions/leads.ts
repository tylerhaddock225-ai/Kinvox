'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Lead } from '@/lib/types/database.types'

export type CreateLeadState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export async function createLead(
  _prev: CreateLeadState,
  formData: FormData,
): Promise<CreateLeadState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization found' }

  const firstName = (formData.get('first_name') as string).trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const { error } = await supabase.from('leads').insert({
    organization_id: profile.organization_id,
    first_name: firstName,
    last_name: ((formData.get('last_name') as string).trim()) || null,
    company: ((formData.get('company') as string).trim()) || null,
    email: ((formData.get('email') as string).trim()) || null,
    source: (formData.get('source') as Lead['source']) || null,
    status: (formData.get('status') as Lead['status']) || 'new',
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/')
  return { status: 'success' }
}

const LEAD_SOURCES: NonNullable<Lead['source']>[] = ['web', 'referral', 'import', 'manual', 'other']

export type UpdateLeadState = CreateLeadState

export async function updateLead(
  leadId: string,
  _prev: UpdateLeadState,
  formData: FormData,
): Promise<UpdateLeadState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const firstName = ((formData.get('first_name') as string) ?? '').trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const rawSource = (formData.get('source') as string) || ''
  const source    = (LEAD_SOURCES as string[]).includes(rawSource) ? (rawSource as Lead['source']) : null

  const { error } = await supabase.from('leads').update({
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      ((formData.get('phone')     as string) ?? '').trim() || null,
    source,
  }).eq('id', leadId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
  return { status: 'success' }
}

const LEAD_STATUSES: Lead['status'][] = ['new', 'contacted', 'qualified', 'lost', 'converted']

export async function updateLeadStatus(leadId: string, status: string): Promise<void> {
  if (!(LEAD_STATUSES as string[]).includes(status)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('leads')
    .update({ status: status as Lead['status'] })
    .eq('id', leadId)

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/leads')
  revalidatePath('/')
}

export type AddNoteState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export async function addLeadNote(
  leadId: string,
  _prev: AddNoteState,
  formData: FormData,
): Promise<AddNoteState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const content = (formData.get('content') as string | null)?.trim()
  if (!content) return { status: 'error', error: 'Note cannot be empty' }

  const { error } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: user.id,
    content,
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/leads/${leadId}`)
  return { status: 'success' }
}
