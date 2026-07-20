'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hqGate } from '@/lib/permissions/gates'
import { sweepUnansweredTickets, drainDraftJobs } from '@/lib/ai/auto-draft'

type LedgerType = 'purchase' | 'refund' | 'adjustment'
const LEDGER_TYPES: readonly LedgerType[] = ['purchase', 'refund', 'adjustment']

function integrationsTab(orgId: string, extra = ''): string {
  const base = `/hq/organizations/${orgId}?tab=integrations-billing`
  return extra ? `${base}&${extra}` : base
}

/**
 * HQ-driven credit adjustment. Positive `amount` adds balance (purchase
 * grant / manual credit); negative amounts subtract. Every movement is
 * stamped in credit_ledger for audit parity with deduct_credit().
 */
export async function addCredits(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const gate = await hqGate(supabase, user.id, 'manage_credits')
  if (!gate.ok) redirect('/login')

  const orgId  = String(formData.get('org_id') ?? '').trim()
  const amount = parseInt(String(formData.get('amount') ?? ''), 10)
  const type   = String(formData.get('type') ?? 'purchase').trim() as LedgerType

  if (!orgId)               redirect('/hq/organizations')
  if (!Number.isFinite(amount) || amount === 0) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent('Enter a non-zero amount')))
  }
  if (!LEDGER_TYPES.includes(type)) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent('Invalid ledger type')))
  }

  // Read → mutate → ledger-insert, all under is_admin_hq RLS. We avoid
  // racing the AI worker's deduct_credit() by letting Postgres serialise
  // concurrent UPDATEs on the same row (single-row UPDATE is atomic).
  const { data: row, error: readErr } = await supabase
    .from('organization_credits')
    .select('balance')
    .eq('organization_id', orgId)
    .maybeSingle<{ balance: number }>()

  if (readErr || !row) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent('Credits row missing')))
  }

  const nextBalance = row.balance + amount
  if (nextBalance < 0) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent('Resulting balance cannot be negative')))
  }

  const { error: updateErr } = await supabase
    .from('organization_credits')
    .update({ balance: nextBalance })
    .eq('organization_id', orgId)

  if (updateErr) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent(updateErr.message)))
  }

  const { error: ledgerErr } = await supabase
    .from('credit_ledger')
    .insert({
      organization_id: orgId,
      amount,
      type,
      reference_id: null,
    })

  if (ledgerErr) {
    // Balance already mutated; surface the ledger-side error without
    // rolling back — HQ can reconcile manually if this ever fires.
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent('Balance updated but ledger insert failed: ' + ledgerErr.message)))
  }

  // AD Stage 6 — a positive grant may unblock tickets whose auto-draft was skipped
  // at zero balance. Sweep the unanswered backlog + drain after the response (a
  // negative refund/adjustment never triggers this). Registered BEFORE the redirect
  // below, which throws NEXT_REDIRECT to unwind — after() still fires post-response.
  // Best-effort; a sweep hiccup must never surface as a credit-grant failure.
  if (amount > 0) {
    after(async () => {
      try {
        await sweepUnansweredTickets(orgId)
        await drainDraftJobs(10)
      } catch (err) {
        console.error(`[refill-sweep] hq addCredits sweep/drain failed org=${orgId}:`, err)
      }
    })
  }

  revalidatePath(`/hq/organizations/${orgId}`)
  redirect(integrationsTab(orgId, 'credits_added=' + encodeURIComponent(String(amount))))
}

/**
 * Toggle + configure auto-top-up. A threshold of 0 or an amount of 0
 * disables the feature regardless of the boolean.
 */
export async function updateAutoTopUp(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const gate = await hqGate(supabase, user.id, 'manage_credits')
  if (!gate.ok) redirect('/login')

  const orgId     = String(formData.get('org_id') ?? '').trim()
  const enabled   = String(formData.get('enabled') ?? '') === 'on'
  const threshold = parseInt(String(formData.get('threshold') ?? ''), 10)
  const topUp     = parseInt(String(formData.get('top_up_amount') ?? ''), 10)

  if (!orgId) redirect('/hq/organizations')

  const patch: {
    auto_top_up_enabled: boolean
    top_up_threshold:    number | null
    top_up_amount:       number | null
  } = {
    auto_top_up_enabled: enabled,
    top_up_threshold:    Number.isFinite(threshold) && threshold >= 0 ? threshold : null,
    top_up_amount:       Number.isFinite(topUp) && topUp > 0 ? topUp : null,
  }

  const { error } = await supabase
    .from('organization_credits')
    .update(patch)
    .eq('organization_id', orgId)

  if (error) {
    redirect(integrationsTab(orgId, 'credits_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/hq/organizations/${orgId}`)
  redirect(integrationsTab(orgId, 'topup_saved=1'))
}
