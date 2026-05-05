import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
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

/**
 * Tenant-admin gate for write actions. Two ways to pass:
 *   1. The caller is an HQ admin acting via resolveImpersonation — orgId
 *      is the impersonated org, which won't equal the caller's own
 *      profile.organization_id, so the impersonating branch grants access.
 *   2. The caller's profile.organization_id matches orgId AND
 *      profile.role = 'admin'.
 *
 * Mirrors the inline pattern that previously appeared in saveHuntingProfile
 * and disconnectSocialPlatform — same predicate, deduplicated.
 */
/**
 * Resolves the URL slug for a tenant org. Used to scope revalidatePath /
 * server-side redirects under the [orgSlug] segment after the routing
 * migration. Returns null on missing row or query error — callers decide
 * whether silence is acceptable (revalidate misses are best-effort; a
 * post-insert redirect probably wants a stricter fallback).
 */
export async function resolveOrgSlug(
  supabase: SupabaseServerClient,
  orgId:    string,
): Promise<string | null> {
  const { data } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .maybeSingle<{ slug: string | null }>()
  return data?.slug ?? null
}

/**
 * Best-effort scoped revalidation. Resolves the org slug then revalidates
 * `/<slug><suffix>`; if the slug can't be resolved, logs a one-line warn
 * and skips. The caller's data write already succeeded — cache invalidation
 * being slightly stale is acceptable. Crashing the action just to refresh
 * a list is not.
 *
 * `suffix` should start with `/` (e.g. `/tickets`, `/tickets/${id}`).
 */
export async function revalidateOrgPath(
  supabase: SupabaseServerClient,
  orgId:    string,
  suffix:   string,
): Promise<void> {
  const slug = await resolveOrgSlug(supabase, orgId)
  if (!slug) {
    console.warn(`[revalidate] could not resolve slug for org=${orgId} suffix=${suffix}`)
    return
  }
  revalidatePath(`/${slug}${suffix}`)
}

export async function requireTenantAdmin(
  supabase: SupabaseServerClient,
  userId: string,
  orgId: string,
  unauthorizedMessage = 'Only org admins can perform this action',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single<{ organization_id: string | null; role: string | null }>()

  const impersonating = profile?.organization_id !== orgId
  if (!impersonating && profile?.role !== 'admin') {
    return { ok: false, error: unauthorizedMessage }
  }
  return { ok: true }
}
