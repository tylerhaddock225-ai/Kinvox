'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId, resolveOrgSlug, revalidateOrgPath } from '@/lib/impersonation'
import { normalizeToE164 } from '@/lib/phone'

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

  // Fail-open: normalize to E.164 for the SMS rail, but never reject on a bad
  // phone — store the raw trimmed input when it won't parse.
  const phoneRaw = ((formData.get('phone') as string) ?? '').trim()

  const { data: inserted, error } = await supabase.from('customers').insert({
    organization_id: orgId,
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      phoneRaw ? (normalizeToE164(phoneRaw) ?? phoneRaw) : null,
  }).select('id').single()

  if (error) return { status: 'error', error: error.message }

  // Resolve slug once for both the revalidate and the post-insert redirect.
  // If slug lookup fails (org row vanished between insert and redirect, which
  // would be very unusual), bounce to /onboarding — the user's org context
  // is broken and the current detail URL won't resolve anyway.
  const slug = await resolveOrgSlug(supabase, orgId)
  if (!slug) {
    console.warn(`[revalidate] could not resolve slug for org=${orgId} suffix=/customers`)
    redirect('/onboarding')
  }
  revalidateOrgPath(supabase, orgId, '/customers')
  redirect(`/${slug}/customers/${inserted.id}`)
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

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  // Fail-open E.164 normalization (see createNewCustomer).
  const phoneRaw = ((formData.get('phone') as string) ?? '').trim()

  const { error } = await supabase.from('customers').update({
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      phoneRaw ? (normalizeToE164(phoneRaw) ?? phoneRaw) : null,
  }).eq('id', customerId)

  if (error) return { status: 'error', error: error.message }

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
    await revalidateOrgPath(supabase, orgId, '/customers')
  }
  return { status: 'success' }
}


// ── updateCustomerStatus ────────────────────────────────────────────────────

export async function updateCustomerStatus(customerId: string, status: string): Promise<void> {
  if (!(CUSTOMER_STATUSES as string[]).includes(status)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  await supabase
    .from('customers')
    .update({ status })
    .eq('id', customerId)

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
    await revalidateOrgPath(supabase, orgId, '/customers')
  }
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

  await revalidateOrgPath(supabase, orgId, '/customers')
  await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
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

  await revalidateOrgPath(supabase, orgId, '/customers')
  await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
}


// ── setCustomerSmsOptIn ─────────────────────────────────────────────────────
//
// SMS Stage 2a — org-side manual consent toggle (for verbal "just text me"
// consent, e.g. over the phone). Same gating as the edit modals: auth + RLS
// (the "Org members can update customers" policy scopes the write to the org).
// Turning ON records consent + a timestamp and nulls any pending opt-in token;
// turning OFF clears both and the token. NOTHING is sent — this is consent state
// only.

export async function setCustomerSmsOptIn(customerId: string, optIn: boolean): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  const patch = optIn
    ? { sms_opt_in: true,  sms_opted_in_at: new Date().toISOString(), sms_opt_in_token: null }
    : { sms_opt_in: false, sms_opted_in_at: null,                     sms_opt_in_token: null }

  const { error } = await supabase.from('customers').update(patch).eq('id', customerId)
  if (error) {
    console.error(`[customer-sms-optin] update failed customer=${customerId}: ${error.message}`)
    return
  }

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
    await revalidateOrgPath(supabase, orgId, '/customers')
  }
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

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  const { error } = await supabase
    .from('customer_activities')
    .insert({ customer_id: customerId, user_id: user.id, content })

  if (error) return { status: 'error', error: error.message }

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/customers/${customerId}`)
  }
  return { status: 'success' }
}
