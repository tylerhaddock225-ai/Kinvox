import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { IMPERSONATION_COOKIE } from '@/app/actions/impersonation'

export type ImpersonationContext =
  | { active: false; orgId: null; orgName: null }
  | { active: true;  orgId: string; orgName: string }

/**
 * Resolves impersonation state from (in priority order):
 *   1. The explicit URL param (`?impersonate=<orgId>`).
 *   2. The `kinvox_impersonate_id` cookie set by startImpersonation().
 *
 * Gated on `public.is_admin_hq()` so non-admins who somehow possess
 * the cookie get a safe no-op. RLS is the ultimate enforcement:
 * SELECT policies on org-scoped tables include
 * `public.is_admin_hq() OR organization_id = auth_user_org_id()`.
 */
export async function resolveImpersonation(
  param?: string,
): Promise<ImpersonationContext> {
  let orgId = param?.trim() || undefined
  if (!orgId) {
    const jar = await cookies()
    orgId = jar.get(IMPERSONATION_COOKIE)?.value
  }
  if (!orgId) return { active: false, orgId: null, orgName: null }

  const supabase = await createClient()

  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) return { active: false, orgId: null, orgName: null }

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .single<{ name: string }>()

  if (!org) return { active: false, orgId: null, orgName: null }

  return { active: true, orgId, orgName: org.name }
}
