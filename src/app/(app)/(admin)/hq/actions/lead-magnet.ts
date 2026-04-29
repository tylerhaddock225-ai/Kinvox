'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Lowercase letters, digits, hyphens. Must start and end with alnum so we
// can always interpolate it into a URL path without weird edge cases.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

async function requireAdmin() {
  const supabase = await createClient()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin) redirect('/login')
  return supabase
}

export async function updateLeadMagnet(formData: FormData) {
  const orgId       = String(formData.get('org_id')       ?? '').trim()
  if (!orgId) redirect('/hq/organizations')

  const rawSlug     = String(formData.get('slug')         ?? '').trim().toLowerCase()
  const enabled     = formData.get('enabled') === 'on'
  const headline    = String(formData.get('headline')     ?? '').trim()
  const websiteUrl  = String(formData.get('website_url')  ?? '').trim()

  const tabSuffix = '?tab=lead-capture'
  const redirectTo = (msg?: string) => {
    const qs = new URLSearchParams({ tab: 'lead-capture' })
    if (msg) qs.set('error', msg)
    return redirect(`/hq/organizations/${orgId}?${qs.toString()}`)
  }

  // Empty slug → explicit "disabled" intent. Accept it and clear the column.
  // Non-empty slug must match the strict format before we even try the DB.
  const slug = rawSlug === '' ? null : rawSlug
  if (slug && !SLUG_RE.test(slug)) {
    return redirectTo('Slug must be lowercase letters, numbers, and hyphens only.')
  }

  // Website is optional, but if present must be a parseable http(s) URL.
  let normalizedWebsite: string | null = null
  if (websiteUrl) {
    try {
      const parsed = new URL(websiteUrl)
      if (!/^https?:$/.test(parsed.protocol)) {
        return redirectTo('Website URL must start with http:// or https://')
      }
      normalizedWebsite = parsed.toString()
    } catch {
      return redirectTo('Website URL is not a valid URL.')
    }
  }

  const supabase = await requireAdmin()

  // Sprint 3 split: HQ owns slug/enabled/headline; the Organization owns
  // `features` via their own Lead Support editor. The jsonb merge happens
  // server-side via merge_lead_magnet_settings — concurrent HQ + org saves
  // cannot clobber each other's keys.
  const { error: rpcErr } = await supabase.rpc('merge_lead_magnet_settings', {
    p_org_id: orgId,
    p_patch:  {
      enabled:  enabled && !!slug,        // no slug ⇒ implicitly disabled
      headline: headline || 'Check your eligibility',
    },
  })
  if (rpcErr) return redirectTo(rpcErr.message)

  // Top-level columns (not inside the jsonb) still need a normal UPDATE.
  // Trade-off: the RPC and this UPDATE are not transactional with each
  // other — if this fails after the RPC succeeds, the jsonb has the new
  // headline/enabled but slug/website are stale. Same partial-failure
  // surface area the previous one-write code had (mid-statement crash);
  // not worse. If we ever need true atomicity, fold these columns into
  // the RPC signature.
  const { error } = await supabase
    .from('organizations')
    .update({
      lead_magnet_slug: slug,
      website_url:      normalizedWebsite,
    })
    .eq('id', orgId)

  if (error) {
    // 23505 = unique_violation. Surface a human message instead of leaking
    // the constraint name.
    if (error.code === '23505') {
      return redirectTo('That slug is already in use by another organization.')
    }
    return redirectTo(error.message)
  }

  revalidatePath(`/hq/organizations/${orgId}`)
  redirect(`/hq/organizations/${orgId}${tabSuffix}`)
}
