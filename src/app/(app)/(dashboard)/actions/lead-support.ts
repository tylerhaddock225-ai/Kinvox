'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { normalizeLeadQuestions, MAX_QUESTIONS } from '@/lib/lead-questions'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

// Zero-Inference: actions bind to the caller's OWN profile.organization_id.
// HQ admins have their own mutation path under /admin-hq and must use it;
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

  revalidatePath('/settings/team')
  revalidatePath('/signals')
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

  revalidatePath('/settings/team')
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

  revalidatePath('/settings/team')
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

  revalidatePath('/settings/team')
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

  revalidatePath('/settings/team')
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

  revalidatePath('/settings/team')
  return {
    status:  'success',
    message: cleaned.length
      ? `Saved ${cleaned.length} custom question${cleaned.length === 1 ? '' : 's'}.`
      : 'Custom questions cleared.',
  }
}
