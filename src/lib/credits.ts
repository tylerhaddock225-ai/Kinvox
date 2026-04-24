import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { OrganizationCredits } from '@/lib/types/database.types'

// Signals are indivisible — all credit amounts are whole numbers.
export type DeductCreditResult =
  | { ok: true;  balance: number }
  | { ok: false; reason: 'insufficient_credits'; requested: number }

/**
 * Reads the org's live balance via the anon/authenticated client so RLS
 * enforces access. Callers inside an HQ impersonation flow should pass
 * the `orgId` returned by `resolveImpersonation()`; tenant flows should
 * pass their own org id. RLS short-circuits via `is_admin_hq()` for HQ.
 */
export async function getOrgCredits(
  organizationId: string,
): Promise<OrganizationCredits | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('organization_credits')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle<OrganizationCredits>()
  return data ?? null
}

/**
 * Invokes the `deduct_credit` RPC with service-role credentials. Execution
 * is locked down to `service_role` at the database layer, so this helper
 * must only be called from trusted server paths (AI signal worker, HQ
 * route handlers). Returns a discriminated union so callers can route
 * an 'insufficient_credits' result into the Top-Up flow instead of
 * treating it as an unexpected error.
 */
export async function deductCredit(
  organizationId: string,
  amount: number,
  referenceId: string,
): Promise<DeductCreditResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('deductCredit: amount must be a positive integer')
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('deduct_credit', {
    org_id: organizationId,
    amount,
    ref_id: referenceId,
  })

  if (error) {
    if (error.message?.includes('insufficient_credits')) {
      return { ok: false, reason: 'insufficient_credits', requested: amount }
    }
    throw error
  }

  return { ok: true, balance: data as number }
}
