import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export const IMPERSONATION_COOKIE = 'kinvox_impersonate_id'

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

/**
 * Zero-Inference: returns the organization_id that a server action should
 * write into. When an HQ admin is "acting as" a tenant, that's the
 * impersonated org. Otherwise it's the caller's own profile.organization_id.
 * Returns null when neither resolves — callers must treat null as an error
 * and refuse to write, never fall back to a default.
 */
export async function resolveEffectiveOrgId(
  supabase: SupabaseServerClient,
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
