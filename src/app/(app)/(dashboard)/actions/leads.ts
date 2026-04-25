'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import { deductCredit } from '@/lib/credits'
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

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization found' }

  const firstName = (formData.get('first_name') as string).trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const lastName = ((formData.get('last_name') as string).trim()) || null
  const company  = ((formData.get('company')   as string).trim()) || null
  const email    = ((formData.get('email')     as string).trim()) || null

  const { data: lead, error } = await supabase.from('leads').insert({
    organization_id: orgId,
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
  revalidatePath('/[orgSlug]/leads', 'page')
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
  revalidatePath('/[orgSlug]/leads', 'page')
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
  revalidatePath('/[orgSlug]/leads', 'page')
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

// ─────────────────────────────────────────────────────────────────────
// Pay-on-Unlock
// ─────────────────────────────────────────────────────────────────────

export type UnlockLeadState =
  | { status: 'success' }
  | { status: 'error'; error: string; reason?: 'insufficient_credits' }
  | null

// Atomically charges the org 1 credit and reveals a pending_unlock lead.
//
// Trust boundary:
//   - leadId comes from the client, so we re-resolve the lead's org and
//     verify it matches the caller's effective org. Zero-Inference: the
//     caller never tells us "this lead belongs to org X."
//   - HQ admins impersonating a tenant unlock on behalf of that tenant
//     (resolveEffectiveOrgId returns the impersonated org id).
//
// Idempotency:
//   - If the lead is already non-pending, we treat it as a success no-op.
//   - If two concurrent calls race past the status check, the partial
//     unique index credit_ledger_signal_dedup raises 23505 from inside
//     the deduct_credit RPC; the RPC's transaction rolls back the balance
//     decrement, and we treat the second caller as already-paid.
export async function unlockLead(leadId: string): Promise<UnlockLeadState> {
  if (typeof leadId !== 'string' || leadId.length === 0) {
    return { status: 'error', error: 'Missing leadId' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  // Re-resolve the lead server-side and verify ownership. RLS would also
  // hide cross-tenant leads, but we read the org id explicitly so we can
  // distinguish "wrong tenant" from "missing lead" in error responses.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, organization_id, status')
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; organization_id: string; status: string }>()

  if (!lead)                              return { status: 'error', error: 'Lead not found' }
  if (lead.organization_id !== orgId)     return { status: 'error', error: 'Lead not found' }
  if (lead.status !== 'pending_unlock')   return { status: 'success' }

  // Charge first, reveal second. The partial unique index makes the
  // deduct idempotent on retry, so if the status flip below ever fails
  // (DB outage, etc.) the merchant can re-click without double-billing.
  let chargeResult: Awaited<ReturnType<typeof deductCredit>>
  try {
    chargeResult = await deductCredit(orgId, 1, lead.id)
  } catch (err: unknown) {
    // 23505 from the credit_ledger_signal_dedup partial unique index.
    // The RPC's transaction rolled back the balance decrement, so the
    // org has NOT been charged twice. Fall through to the status flip
    // and treat the unlock as already-paid.
    const code = (err as { code?: string })?.code
    if (code !== '23505') {
      const msg = err instanceof Error ? err.message : 'Unlock failed'
      return { status: 'error', error: msg }
    }
    chargeResult = { ok: true, balance: 0 }   // balance value is not surfaced to UI
  }

  if (!chargeResult.ok) {
    return {
      status: 'error',
      error:  'Insufficient credits — top up to unlock this lead.',
      reason: 'insufficient_credits',
    }
  }

  // Atomic flip: scoped to status='pending_unlock' so a concurrent winner
  // doesn't get its unlocked_at overwritten by ours. Zero rows affected
  // here is OK — the credit was already (idempotently) charged and the
  // lead is unlocked one way or the other.
  const { error: updErr } = await supabase
    .from('leads')
    .update({
      status:      'new',
      unlocked_at: new Date().toISOString(),
      unlocked_by: user.id,
    })
    .eq('id', lead.id)
    .eq('status', 'pending_unlock')

  if (updErr) {
    // Charge succeeded but the reveal didn't land. Surface as error so the
    // merchant retries; the partial unique index protects against double
    // charge on retry.
    return { status: 'error', error: 'Unlock half-completed — refresh and try again.' }
  }

  revalidatePath('/[orgSlug]/leads', 'page')
  revalidatePath(`/leads/${lead.id}`)
  return { status: 'success' }
}
