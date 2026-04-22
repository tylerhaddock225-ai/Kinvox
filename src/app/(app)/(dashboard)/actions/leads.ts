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

  const lastName = ((formData.get('last_name') as string).trim()) || null
  const company  = ((formData.get('company')   as string).trim()) || null
  const email    = ((formData.get('email')     as string).trim()) || null

  const { data: lead, error } = await supabase.from('leads').insert({
    organization_id: profile.organization_id,
    first_name: firstName,
    last_name:  lastName,
    company,
    email,
    source: (formData.get('source') as Lead['source']) || null,
    status: (formData.get('status') as Lead['status']) || 'new',
  }).select('id').single()

  if (error) return { status: 'error', error: error.message }

  // Customer creation is deferred until the lead is converted (see
  // updateLeadStatus below). The two tables stay decoupled at insert
  // time so a never-converted lead never shows up in Customers.
  void lead

  revalidatePath('/')
  revalidatePath('/leads')
  return { status: 'success' }
}

type MirrorArgs = {
  leadId:         string
  organizationId: string
  firstName:      string
  lastName:       string | null
  email:          string | null
  company:        string | null
}

async function mirrorLeadToCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  m: MirrorArgs,
): Promise<void> {
  // 1. If a customer with this (org, email) already exists and isn't yet
  //    linked to a lead, attach this lead to it. The unique partial index
  //    on (organization_id, lower(email)) WHERE deleted_at IS NULL
  //    guarantees at most one match per email per org.
  if (m.email) {
    const { error: linkErr } = await supabase
      .from('customers')
      .update({ lead_id: m.leadId })
      .eq('organization_id', m.organizationId)
      .ilike('email', m.email.replace(/[\\%_]/g, c => '\\' + c))
      .is('deleted_at', null)
      .is('lead_id', null)
    if (linkErr) {
      console.warn(`[lead-mirror] link existing customer failed lead=${m.leadId}: ${linkErr.message}`)
    }
  }

  // 2. If no customer is now associated with this lead, insert one.
  const { data: already } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', m.organizationId)
    .eq('lead_id', m.leadId)
    .maybeSingle()

  if (already) return

  const { error: insErr } = await supabase.from('customers').insert({
    organization_id: m.organizationId,
    lead_id:         m.leadId,
    first_name:      m.firstName,
    last_name:       m.lastName,
    email:           m.email,
    company:         m.company,
  })
  if (insErr) {
    console.warn(`[lead-mirror] customer insert failed lead=${m.leadId}: ${insErr.message}`)
  }
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

  const { error: updErr } = await supabase
    .from('leads')
    .update({ status: status as Lead['status'] })
    .eq('id', leadId)
  if (updErr) {
    console.warn(`[lead-status] update failed lead=${leadId}: ${updErr.message}`)
    return
  }

  // Convert-on-demand: when (and only when) the lead flips to 'converted'
  // for the first time, mirror it into customers. Any other status change
  // \u2014 including leaving 'converted' \u2014 leaves the customer row untouched
  // so downstream records (tickets, appointments) never lose their link.
  if (status === 'converted') {
    // Pull the org-scoped lead snapshot the mirror helper needs.
    const { data: lead } = await supabase
      .from('leads')
      .select('id, organization_id, first_name, last_name, email, company')
      .eq('id', leadId)
      .is('deleted_at', null)
      .maybeSingle()

    if (lead) {
      const { data: already } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle()

      if (!already) {
        await mirrorLeadToCustomer(supabase, {
          leadId:         lead.id,
          organizationId: lead.organization_id,
          firstName:      lead.first_name,
          lastName:       lead.last_name,
          email:          lead.email,
          company:        lead.company,
        })
        revalidatePath('/customers')
      }
    }
  }

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
