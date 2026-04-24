// POST /api/v1/signals/capture
//
// Public ingestion endpoint for AI social-listening agents (Make.com, n8n,
// custom workers). Authenticates the caller via x-kinvox-api-key, scores
// the post intent (1/3/6), deducts that many credits via the service-
// role-locked deduct_credit RPC, then:
//   - signal_engagement_mode='manual'   → insert into leads (direct).
//   - signal_engagement_mode='ai_draft' → generate a draft reply and
//                                         insert into pending_signals.
// Either path broadcasts via supabase_realtime so dashboards pop.
//
// Auth: sha256(raw_key) matched against organization_api_keys.key_hash.
// Billing: deductCredit() is atomic — if it fails the signal is not stored.
// Top-Up: on 402 we return a top_up_url the caller can surface to the tenant.
// Privacy: both AI steps (score + draft) scrub PII before persistence.

import { createHash, randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deductCredit } from '@/lib/credits'
import { scoreSignalIntent, generateDraftReply } from '@/lib/ai/intent-scorer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Payload = {
  platform?:         string
  raw_text?:         string
  location?:         string
  author_name?:      string
  author_handle?:    string
  source_url?:       string
  signal_config_id?: string
  vertical?:         string
  latitude?:         number
  longitude?:        number
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.7613 // earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-kinvox-api-key')?.trim()
  if (!apiKey) return json({ error: 'missing_api_key' }, 401)

  let body: Payload
  try {
    body = (await request.json()) as Payload
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const platform = typeof body.platform === 'string' ? body.platform.trim() : ''
  const rawText  = typeof body.raw_text === 'string' ? body.raw_text.trim() : ''
  const location = typeof body.location === 'string' ? body.location.trim() : ''

  if (!platform) return json({ error: 'platform is required' },  400)
  if (!rawText)  return json({ error: 'raw_text is required' },  400)
  if (!location) return json({ error: 'location is required' },  400)

  const admin   = createAdminClient()
  const keyHash = hashKey(apiKey)

  const { data: keyRow } = await admin
    .from('organization_api_keys')
    .select('id, organization_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle<{ id: string; organization_id: string; revoked_at: string | null }>()

  if (!keyRow || keyRow.revoked_at) return json({ error: 'invalid_api_key' }, 401)

  const orgId = keyRow.organization_id

  // Org-level kill switch + engagement-mode + draft-link prerequisites.
  // When paused we bail BEFORE the ledger so no credits are consumed.
  // ai_draft mode requires a lead_magnet_slug because the draft template
  // must produce a working link; without one we'd post a 404.
  const { data: org } = await admin
    .from('organizations')
    .select('name, ai_listening_enabled, signal_engagement_mode, lead_magnet_slug, deleted_at, latitude, longitude, signal_radius')
    .eq('id', orgId)
    .maybeSingle<{
      name:                   string
      ai_listening_enabled:   boolean
      signal_engagement_mode: 'ai_draft' | 'manual'
      lead_magnet_slug:       string | null
      deleted_at:             string | null
      latitude:               number | null
      longitude:              number | null
      signal_radius:          number | null
    }>()

  if (!org || org.deleted_at) return json({ error: 'organization_unavailable' }, 404)
  if (!org.ai_listening_enabled) {
    return json({ error: 'feature_disabled_by_organization' }, 403)
  }
  if (org.signal_engagement_mode === 'ai_draft' && !org.lead_magnet_slug) {
    // Tenants opting into drafts must have a live landing page first.
    // We fail BEFORE deduction so there's no refund bookkeeping.
    return json(
      { error: 'landing_slug_not_configured', hint: 'ai_draft mode requires organizations.lead_magnet_slug' },
      409,
    )
  }

  const callerLat = typeof body.latitude  === 'number' ? body.latitude  : null
  const callerLng = typeof body.longitude === 'number' ? body.longitude : null

  // ── Org-level geofence gate ──────────────────────────────────────────
  // Applies BEFORE per-signal-config geofence, AI scoring, and deduction.
  // Only engages when the org has an anchor + radius configured AND the
  // caller supplied coordinates — otherwise we let the per-config gate
  // below make the call. Rejections here are free of charge.
  if (
    org.latitude      !== null &&
    org.longitude     !== null &&
    org.signal_radius !== null &&
    callerLat         !== null &&
    callerLng         !== null
  ) {
    const miles = haversineMiles(callerLat, callerLng, org.latitude, org.longitude)
    if (miles > org.signal_radius) {
      return json(
        {
          status:   'rejected',
          reason:   'out_of_bounds',
          distance: Number(miles.toFixed(2)),
          error:    'Out of organization service area',
          code:     'ORG_GEOFENCE_REJECTION',
        },
        422,
      )
    }
  }

  // ── Signal config resolution + geofence ──────────────────────────────
  // Backwards-compat: callers that send neither signal_config_id nor
  // vertical flow through unchanged (no attribution, no geofence).
  // The geofence check runs BEFORE scoreSignalIntent / deductCredit so
  // out-of-area noise is rejected free of charge.
  let signalConfigId:   string | null = null
  let configCenterLat:  number | null = null
  let configCenterLong: number | null = null
  let configRadius:     number | null = null

  const rawConfigId = typeof body.signal_config_id === 'string' ? body.signal_config_id.trim() : ''
  const rawVertical = typeof body.vertical         === 'string' ? body.vertical.trim()         : ''

  if (rawConfigId) {
    const { data: cfg } = await admin
      .from('signal_configs')
      .select('id, organization_id, center_lat, center_long, radius_miles, is_active')
      .eq('id', rawConfigId)
      .maybeSingle<{
        id:              string
        organization_id: string
        center_lat:      number | null
        center_long:     number | null
        radius_miles:    number
        is_active:       boolean
      }>()

    // Explicit IDs that don't resolve are hard-rejected. Silent fallback
    // would mask a misconfigured worker pointing at a deleted config.
    if (!cfg || cfg.organization_id !== orgId || !cfg.is_active) {
      return json({ error: 'invalid_signal_config' }, 404)
    }

    signalConfigId   = cfg.id
    configCenterLat  = cfg.center_lat
    configCenterLong = cfg.center_long
    configRadius     = cfg.radius_miles
  } else if (rawVertical) {
    // Vertical-based resolution is graceful: no config → proceed without
    // attribution. Lets orgs onboard workers before signal_configs rows
    // are provisioned, or run without per-vertical routing.
    const { data: cfg } = await admin
      .from('signal_configs')
      .select('id, center_lat, center_long, radius_miles')
      .eq('organization_id', orgId)
      .eq('vertical', rawVertical)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle<{
        id:           string
        center_lat:   number | null
        center_long:  number | null
        radius_miles: number
      }>()

    if (cfg) {
      signalConfigId   = cfg.id
      configCenterLat  = cfg.center_lat
      configCenterLong = cfg.center_long
      configRadius     = cfg.radius_miles
    }
  }

  if (
    configCenterLat  !== null &&
    configCenterLong !== null &&
    configRadius     !== null &&
    callerLat        !== null &&
    callerLng        !== null
  ) {
    const miles = haversineMiles(callerLat, callerLng, configCenterLat, configCenterLong)
    if (miles > configRadius) {
      return json(
        {
          status:       'rejected',
          reason:       'out_of_bounds',
          distance:     Number(miles.toFixed(2)),
          error:        'out_of_geofence',
          miles:        Number(miles.toFixed(2)),
          radius_miles: configRadius,
        },
        422,
      )
    }
  }

  const signalId = randomUUID()
  const authorName   = typeof body.author_name   === 'string' ? body.author_name.trim()   : ''
  const authorHandle = typeof body.author_handle === 'string' ? body.author_handle.trim() : ''

  // Score FIRST — the deduction amount is whatever the AI returns (1/3/6).
  // The scorer gracefully falls back to tier 1 when the API key is missing
  // or the upstream errors; it never throws. PII scrubbing happens inside
  // the scorer, so the snippet we persist is already clean.
  const score = await scoreSignalIntent({
    platform,
    raw_text:      rawText,
    location,
    author_name:   authorName || undefined,
    author_handle: authorHandle || undefined,
  })

  const deduction = await deductCredit(orgId, score.intent_score, signalId)
  if (!deduction.ok) {
    // 402 Payment Required — the Make.com/n8n side surfaces top_up_url to
    // the tenant so they can replenish. The path is relative; the caller's
    // own UI layer decides the full URL.
    return json(
      {
        error:        'insufficient_credits',
        requested:    score.intent_score,
        intent_score: score.intent_score,
        top_up_url:   '/billing/top-up',
      },
      402,
    )
  }

  // Best-effort last_used_at stamp. Never block the response on this —
  // deduction already committed and the downstream insert is what matters.
  void admin
    .from('organization_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)

  // ── Branch: ai_draft mode ────────────────────────────────────────────
  // Generate a reply and park the row in pending_signals. The tenant
  // reviews + approves from the Signals tab; no lead is created here.
  if (org.signal_engagement_mode === 'ai_draft') {
    const draft = await generateDraftReply({
      organization_name: org.name,
      landing_slug:      org.lead_magnet_slug as string,    // asserted above
      raw_text:          rawText,
      platform,
      author_name:       authorName || undefined,
      author_handle:     authorHandle || undefined,
    })

    const { data: pending, error: insertErr } = await admin
      .from('pending_signals')
      .insert({
        id:                signalId,
        organization_id:   orgId,
        raw_text:          rawText,
        ai_draft_reply:    draft.text,
        reasoning_snippet: score.reasoning_snippet,
        intent_score:      score.intent_score,
        platform,
        status:            'pending',
        external_post_id:  typeof body.source_url === 'string' ? body.source_url : null,
        signal_config_id:  signalConfigId,
      })
      .select('id, created_at')
      .single<{ id: string; created_at: string }>()

    if (insertErr) {
      return json(
        { error: `insert_failed: ${insertErr.message}`, signal_id: signalId },
        500,
      )
    }

    return json({
      ok:                true,
      mode:              'ai_draft',
      pending:           true,
      signal_id:         pending?.id,
      ai_draft_reply:    draft.text,
      intent_score:      score.intent_score,
      reasoning_snippet: score.reasoning_snippet,
      balance:           deduction.balance,
      credits_charged:   score.intent_score,
      draft_skipped:     draft.draft_skipped || undefined,
      pii_redacted:      (score.pii_redacted || draft.pii_redacted) || undefined,
      link_appended:     draft.link_appended || undefined,
    })
  }

  // ── Branch: manual mode ──────────────────────────────────────────────
  // Signal flows straight into leads as before.
  //
  // leads.first_name is NOT NULL. Use the author's first token → handle →
  // a literal fallback so we never reject on a required-field technicality
  // after we've already billed.
  const firstToken = authorName.split(/\s+/).filter(Boolean)[0]
    ?? authorHandle
    ?? 'Signal'
  const spaceIdx  = authorName.indexOf(' ')
  const lastName  = spaceIdx === -1 ? null : authorName.slice(spaceIdx + 1).trim() || null

  const metadata: Record<string, unknown> = {
    signal_id:         signalId,
    platform,
    raw_text:          rawText,
    location,
    captured_via:      'social_listening',
    intent_score:      score.intent_score,
    reasoning_snippet: score.reasoning_snippet,
  }
  if (score.scoring_skipped) metadata.scoring_skipped = true
  if (score.pii_redacted)    metadata.pii_redacted    = true
  if (authorHandle)          metadata.author_handle   = authorHandle
  if (body.source_url)       metadata.source_url      = body.source_url
  if (signalConfigId)        metadata.signal_config_id = signalConfigId

  const { data: lead, error: insertErr } = await admin
    .from('leads')
    .insert({
      organization_id: orgId,
      first_name:      firstToken,
      last_name:       lastName,
      status:          'new',
      source:          'social_listening',
      metadata,
    })
    .select('id, display_id')
    .single<{ id: string; display_id: string | null }>()

  if (insertErr) {
    // Credit already deducted. We do NOT auto-refund — HQ reconciles via
    // the ledger if this ever fires. Signal_id is included so the caller
    // can retry without double-billing on the ledger side.
    return json(
      { error: `insert_failed: ${insertErr.message}`, signal_id: signalId },
      500,
    )
  }

  return json({
    ok:                true,
    mode:              'manual',
    signal_id:         signalId,
    lead_id:           lead?.id,
    display_id:        lead?.display_id,
    balance:           deduction.balance,
    intent_score:      score.intent_score,
    reasoning_snippet: score.reasoning_snippet,
    credits_charged:   score.intent_score,
  })
}
