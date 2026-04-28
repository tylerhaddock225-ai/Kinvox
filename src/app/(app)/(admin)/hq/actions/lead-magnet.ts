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

function parseFeatures(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50) // hard cap — an org listing 50+ features on a lead page is a UX problem
}

export async function updateLeadMagnet(formData: FormData) {
  const orgId       = String(formData.get('org_id')       ?? '').trim()
  if (!orgId) redirect('/admin-hq/organizations')

  const rawSlug     = String(formData.get('slug')         ?? '').trim().toLowerCase()
  const enabled     = formData.get('enabled') === 'on'
  const headline    = String(formData.get('headline')     ?? '').trim()
  const featuresTxt = String(formData.get('features')     ?? '')
  const websiteUrl  = String(formData.get('website_url')  ?? '').trim()

  const tabSuffix = '?tab=lead-capture'
  const redirectTo = (msg?: string) => {
    const qs = new URLSearchParams({ tab: 'lead-capture' })
    if (msg) qs.set('error', msg)
    return redirect(`/admin-hq/organizations/${orgId}?${qs.toString()}`)
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

  const settings = {
    enabled: enabled && !!slug,        // no slug ⇒ implicitly disabled
    headline: headline || 'Check your eligibility',
    features: parseFeatures(featuresTxt),
  }

  const supabase = await requireAdmin()
  const { error } = await supabase
    .from('organizations')
    .update({
      lead_magnet_slug:     slug,
      lead_magnet_settings: settings,
      website_url:          normalizedWebsite,
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

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirect(`/admin-hq/organizations/${orgId}${tabSuffix}`)
}
