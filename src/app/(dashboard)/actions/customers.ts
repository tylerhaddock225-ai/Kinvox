'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// ── Types (shared with client components) ───────────────────────────────────

export type CustomerStatus = 'active' | 'pending' | 'onboarding' | 'completed'

const CUSTOMER_STATUSES: CustomerStatus[] = ['active', 'pending', 'onboarding', 'completed']

export type UpdateCustomerState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export type AddNoteState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// Creation redirects on success, so there's no 'success' branch to render.
export type CreateCustomerState =
  | { status: 'error'; error: string }
  | null


// ── createNewCustomer ───────────────────────────────────────────────────────

export async function createNewCustomer(
  _prev: CreateCustomerState,
  formData: FormData,
): Promise<CreateCustomerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { status: 'error', error: 'No organization found' }

  const firstName = ((formData.get('first_name') as string) ?? '').trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const { data: inserted, error } = await supabase.from('customers').insert({
    organization_id: profile.organization_id,
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      ((formData.get('phone')     as string) ?? '').trim() || null,
  }).select('id').single()

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/customers')
  redirect(`/customers/${inserted.id}`)
}


// ── updateCustomer ──────────────────────────────────────────────────────────

export async function updateCustomer(
  customerId: string,
  _prev: UpdateCustomerState,
  formData: FormData,
): Promise<UpdateCustomerState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const firstName = ((formData.get('first_name') as string) ?? '').trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const { error } = await supabase.from('customers').update({
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      ((formData.get('phone')     as string) ?? '').trim() || null,
  }).eq('id', customerId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
  return { status: 'success' }
}


// ── updateCustomerStatus ────────────────────────────────────────────────────

export async function updateCustomerStatus(customerId: string, status: string): Promise<void> {
  if (!(CUSTOMER_STATUSES as string[]).includes(status)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('customers')
    .update({ status })
    .eq('id', customerId)

  revalidatePath(`/customers/${customerId}`)
  revalidatePath('/customers')
}


// ── archiveCustomer / restoreCustomer ───────────────────────────────────────
//
// Archive is distinct from the legacy deleted_at soft-delete: archived rows
// remain visible in the grid via the \u201CShow Archived\u201D toggle and are always
// restorable. We org-scope the update so RLS can\u2019t silently no-op on a row
// that belongs to another tenant.

async function assertCustomerInOrg(customerId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  return profile?.organization_id ?? null
}

export async function archiveCustomer(formData: FormData): Promise<void> {
  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) return

  const orgId = await assertCustomerInOrg(customerId)
  if (!orgId) return

  const supabase = await createClient()
  await supabase
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', customerId)
    .eq('organization_id', orgId)

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
}

export async function restoreCustomer(formData: FormData): Promise<void> {
  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) return

  const orgId = await assertCustomerInOrg(customerId)
  if (!orgId) return

  const supabase = await createClient()
  await supabase
    .from('customers')
    .update({ archived_at: null })
    .eq('id', customerId)
    .eq('organization_id', orgId)

  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
}


// ── addCustomerNote ─────────────────────────────────────────────────────────

export async function addCustomerNote(
  customerId: string,
  _prev: AddNoteState,
  formData: FormData,
): Promise<AddNoteState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const content = (formData.get('content') as string | null)?.trim()
  if (!content) return { status: 'error', error: 'Note cannot be empty' }

  const { error } = await supabase
    .from('customer_activities')
    .insert({ customer_id: customerId, user_id: user.id, content })

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/customers/${customerId}`)
  return { status: 'success' }
}
