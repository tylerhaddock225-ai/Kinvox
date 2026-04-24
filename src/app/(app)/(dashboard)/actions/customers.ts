'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'

// Zero-Inference: creates write into the impersonated tenant when an HQ
// admin is "acting as" one; otherwise into the caller's profile org. Never
// a default — absent either resolution, the action errors rather than
// silently writing to the wrong tenant.
async function resolveEffectiveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const impersonation = await resolveImpersonation()
  if (impersonation.active) return impersonation.orgId

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single<{ organization_id: string | null }>()

  return profile?.organization_id ?? null
}

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

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization found' }

  const firstName = ((formData.get('first_name') as string) ?? '').trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const { data: inserted, error } = await supabase.from('customers').insert({
    organization_id: orgId,
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

export async function archiveCustomer(formData: FormData): Promise<void> {
  const customerId = String(formData.get('customer_id') ?? '').trim()
  if (!customerId) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  // Use the impersonation-aware org so an HQ admin "acting as" a tenant
  // hits the tenant's row instead of silently no-op'ing against their
  // own home org.
  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return

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

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return

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
