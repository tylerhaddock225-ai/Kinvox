'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { normalizeLeadQuestions, MAX_QUESTIONS } from '@/lib/lead-questions'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

// Zero-Inference: actions bind to the caller's OWN profile.organization_id.
// HQ admins have their own mutation path under /hq and must use it;
// an impersonating HQ admin will fail the owner/admin role check here.
async function requireOrgAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single<{ organization_id: string | null; role: string | null }>()

  if (!profile?.organization_id) return { ok: false as const, error: 'No organization' }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, owner_id')
    .eq('id', profile.organization_id)
    .single<{ id: string; owner_id: string }>()

  if (!org) return { ok: false as const, error: 'Organization not found' }

  const isOwner = org.owner_id === user.id
  const isAdmin = profile.role === 'admin'
  if (!isOwner && !isAdmin) {
    return { ok: false as const, error: 'You do not have permission to change these settings' }
  }

  return { ok: true as const, userId: user.id, orgId: org.id }
}

export async function setEngagementMode(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const mode = String(formData.get('mode') ?? '').trim()
  if (mode !== 'ai_draft' && mode !== 'manual') {
    return { status: 'error', error: 'Invalid reply strategy' }
  }

  const { error } = await supabase
    .from('organizations')
    .update({ signal_engagement_mode: mode })
    .eq('id', guard.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  revalidatePath('/[orgSlug]/signals', 'page')
  return {
    status:  'success',
    message: mode === 'ai_draft'
      ? 'Switched to AI-Draft Mode — new signals go to the Review Queue.'
      : 'Switched to Manual Mode — new signals go straight to Leads.',
  }
}

export async function setAiListeningEnabled(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const enabled = formData.get('enabled') === 'on'

  const { error } = await supabase
    .from('organizations')
    .update({ ai_listening_enabled: enabled })
    .eq('id', guard.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: enabled ? 'Social listening enabled.' : 'Social listening paused.',
  }
}

/**
 * Tenant-initiated cancellation. Pre-Stripe behavior: we flip
 * cancel_at_period_end=true and leave the subscription *Active* until
 * current_period_end (when that column is populated by the Stripe webhook
 * later). No data is destroyed — re-activating is a matching flag flip.
 */
export async function cancelSubscription(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { error } = await supabase
    .from('organizations')
    .update({ cancel_at_period_end: true })
    .eq('id', guard.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: 'Subscription will cancel at the end of the current billing period.',
  }
}

export async function reactivateSubscription(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { error } = await supabase
    .from('organizations')
    .update({ cancel_at_period_end: false })
    .eq('id', guard.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return { status: 'success', message: 'Subscription reactivated.' }
}

const MIN_PACKAGE = 10
const MAX_PACKAGE = 10_000

/**
 * Tenant-initiated "Buy More Credits" request. Files a platform-support
 * ticket tagged hq_category='billing' so HQ sees it in their queue and can
 * follow up (or apply the grant manually via addCredits). This is the
 * pre-Stripe bridge — when checkout ships, swap this for a checkout
 * session call and drop the ticket.
 */
export async function requestTopUp(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const packageCredits = parseInt(String(formData.get('package_credits') ?? ''), 10)
  if (!Number.isFinite(packageCredits) || packageCredits < MIN_PACKAGE || packageCredits > MAX_PACKAGE) {
    return { status: 'error', error: 'Choose a valid credit package' }
  }

  const { error } = await supabase
    .from('tickets')
    .insert({
      organization_id:     guard.orgId,
      created_by:          guard.userId,
      subject:             `Credit top-up request: ${packageCredits} signals`,
      description:         `The organization is requesting a top-up of ${packageCredits} signal credits. HQ should apply the grant via the Integrations & Billing tab or invoice accordingly.`,
      status:              'open',
      priority:            'medium',
      channel:             'portal',
      is_platform_support: true,
      hq_category:         'billing',
    })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: `Top-up request submitted for ${packageCredits} credits. Our team will follow up shortly.`,
  }
}

/**
 * Replaces the org's lead-questionnaire. The client serialises the full
 * question list as JSON in the `questions_json` form field — this is an
 * "array replace" action, not an incremental patch.
 *
 * Validation runs twice: normalizeLeadQuestions() drops malformed rows
 * (empty labels, oversize strings, duplicate ids, over-count) and the
 * DB CHECK constraint ensures the column stays a JSON array even if the
 * app layer is ever bypassed.
 */
export async function updateLeadQuestions(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const rawJson = String(formData.get('questions_json') ?? '').trim()
  if (!rawJson) return { status: 'error', error: 'Missing questions payload' }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return { status: 'error', error: 'Questions payload is not valid JSON' }
  }

  if (!Array.isArray(parsed)) {
    return { status: 'error', error: 'Questions payload must be an array' }
  }
  if (parsed.length > MAX_QUESTIONS) {
    return { status: 'error', error: `At most ${MAX_QUESTIONS} questions allowed` }
  }

  const cleaned = normalizeLeadQuestions(parsed)

  const { error } = await supabase
    .from('organizations')
    .update({ custom_lead_questions: cleaned })
    .eq('id', guard.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')
  return {
    status:  'success',
    message: cleaned.length
      ? `Saved ${cleaned.length} custom question${cleaned.length === 1 ? '' : 's'}.`
      : 'Custom questions cleared.',
  }
}

// Hard cap mirrored from the (now retired) HQ parseFeatures so the org-side
// editor produces the same shape HQ used to write. Keeps /l/[slug] rendering
// unchanged across the move.
const MAX_FEATURES = 50

type FeaturesUpdateResult =
  | { status: 'ok' }
  | { status: 'error'; error: string }

/**
 * Org-side write path for the lead-magnet "What we offer" bullet list.
 *
 * Sprint 3 split: HQ owns slug/enabled/headline/website; the Organization
 * owns features + custom questions. Both surfaces target the same jsonb
 * column, so the merge happens server-side via merge_lead_magnet_settings —
 * concurrent HQ + org saves cannot clobber each other.
 *
 * Zero-Inference: organization_id is resolved from the caller's session
 * via requireOrgAdmin. The form payload is parsed but never trusted for
 * tenant scoping.
 */
export async function updateLeadMagnetFeatures(
  formData: FormData,
): Promise<FeaturesUpdateResult> {
  const supabase = await createClient()
  const guard = await requireOrgAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const raw = String(formData.get('features') ?? '')
  const parsed = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (parsed.length > MAX_FEATURES) {
    return { status: 'error', error: `Maximum ${MAX_FEATURES} features` }
  }

  const { error: writeErr } = await supabase.rpc('merge_lead_magnet_settings', {
    p_org_id: guard.orgId,
    p_patch:  { features: parsed },
  })
  if (writeErr) return { status: 'error', error: writeErr.message }

  revalidatePath('/[orgSlug]/settings/team', 'page')

  // Public lead-magnet page is force-dynamic, but Vercel's CDN and the
  // App Router data cache can still serve a stale RSC payload to the
  // visitor's tab. Explicitly bust the public surface so the next visit
  // re-renders with the new features.
  const { data: slugRow } = await supabase
    .from('organizations')
    .select('lead_magnet_slug')
    .eq('id', guard.orgId)
    .maybeSingle<{ lead_magnet_slug: string | null }>()
  if (slugRow?.lead_magnet_slug) {
    revalidatePath(`/l/${slugRow.lead_magnet_slug}`, 'page')
  }

  return { status: 'ok' }
}
