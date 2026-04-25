// POST /api/v1/signals/capture
//
// Public ingestion endpoint for AI social-listening agents (Make.com, n8n,
// custom workers). Authenticates via x-kinvox-api-key, scores the post
// intent (1/3/6 — display tier only), and parks every signal into
// pending_signals with status='pending'. Both engagement modes route to
// the same table:
//   - 'ai_draft'  → AI generates a reply, stored in ai_draft_reply.
//   - 'manual'    → ai_draft_reply is NULL; merchant composes after unlock.
//
// Billing: this endpoint is BILLING-NEUTRAL. The pay-on-unlock pivot
// (Sprint 3) moved the credit deduction out of capture and into the
// unlockSignal server action. deduct_credit is now only called by that
// action, on the merchant's explicit click. Out-of-area signals are
// still rejected at capture-time (free of charge).
// Privacy: both AI steps (score + draft) scrub PII before persistence.

import { createHash, randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { ServerClient } from 'postmark'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMiles } from '@/lib/geo'
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
    .select('id, name, slug, ai_listening_enabled, signal_engagement_mode, lead_magnet_slug, deleted_at, latitude, longitude, signal_radius, verified_support_email, verified_support_email_confirmed_at')
    .eq('id', orgId)
    .maybeSingle<{
      id:                                  string
      name:                                string
      slug:                                string | null
      ai_listening_enabled:                boolean
      signal_engagement_mode:              'ai_draft' | 'manual'
      lead_magnet_slug:                    string | null
      deleted_at:                          string | null
      latitude:                            number | null
      longitude:                           number | null
      signal_radius:                       number | null
      verified_support_email:              string | null
      verified_support_email_confirmed_at: string | null
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

  // Best-effort last_used_at stamp. Never block the response on this.
  void admin
    .from('organization_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)

  // ── Unified persistence: every signal lands in pending_signals ───────
  //
  // Both engagement modes route here so no signal can bypass the unlock
  // paywall by going straight to the leads table. Manual mode signals
  // get a NULL ai_draft_reply — the merchant composes their own reply
  // after unlock. ai_draft mode signals get the AI's draft reply,
  // including the lead-magnet URL with signal_id attribution baked in.
  let draftText:        string | null = null
  let draftSkipped     = false
  let draftPiiRedacted = false
  let draftLinkAppended = false

  if (org.signal_engagement_mode === 'ai_draft') {
    const draft = await generateDraftReply({
      organization_name: org.name,
      landing_slug:      org.lead_magnet_slug as string,    // asserted above
      signal_id:         signalId,
      raw_text:          rawText,
      platform,
      author_name:       authorName || undefined,
      author_handle:     authorHandle || undefined,
    })
    draftText         = draft.text
    draftSkipped      = draft.draft_skipped || false
    draftPiiRedacted  = draft.pii_redacted  || false
    draftLinkAppended = draft.link_appended || false
  }

  const { data: pending, error: insertErr } = await admin
    .from('pending_signals')
    .insert({
      id:                signalId,
      organization_id:   orgId,
      raw_text:          rawText,
      ai_draft_reply:    draftText,
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

  // Speed-to-Signal alert: tells the merchant a fresh, locked signal is
  // sitting in the dashboard and how much intent it carries. PII-free
  // body (no raw_text, no author handle) so an inbox compromise doesn't
  // leak the unlock content. Fires for both engagement modes.
  void sendSignalAlertEmail({
    orgId,
    orgName:          org.name,
    recipient:        org.verified_support_email && org.verified_support_email_confirmed_at
                        ? org.verified_support_email
                        : null,
    intentScore:      score.intent_score,
    reasoningSnippet: score.reasoning_snippet,
    platform,
  })

  return json({
    ok:                true,
    mode:              org.signal_engagement_mode,
    pending:           true,
    signal_id:         pending?.id,
    ai_draft_reply:    draftText,
    intent_score:      score.intent_score,
    reasoning_snippet: score.reasoning_snippet,
    draft_skipped:     draftSkipped     || undefined,
    pii_redacted:      (score.pii_redacted || draftPiiRedacted) || undefined,
    link_appended:     draftLinkAppended || undefined,
  })
}

type SignalAlertArgs = {
  orgId:            string
  orgName:          string
  recipient:        string | null
  intentScore:      1 | 3 | 6
  reasoningSnippet: string | null
  platform:         string
}

// Sends "New Signal Captured — Unlock Intent in Dashboard" to the merchant.
// PII-safe: no raw_text, no author handle, no source URL — just the intent
// tier + the AI's scrubbed reasoning_snippet. Best-effort: any failure
// logs and returns; the signal is already in the dashboard regardless.
async function sendSignalAlertEmail({
  orgId,
  recipient,
  intentScore,
  reasoningSnippet,
  platform,
}: SignalAlertArgs): Promise<void> {
  const LOG = '[signal-alert]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — skipping alert for org=${orgId}`)
    return
  }
  if (!recipient) {
    console.warn(`${LOG} org=${orgId} has no verified support email — skipping`)
    return
  }

  const tierLabel = intentScore === 6 ? 'Urgent' : intentScore === 3 ? 'Medium' : 'Low'

  const body = [
    `A new ${tierLabel.toLowerCase()}-intent signal just landed in your dashboard.`,
    '',
    `Platform: ${platform}`,
    `Intent:   ${tierLabel}`,
    reasoningSnippet ? `AI read:  ${reasoningSnippet}` : 'AI read:  (no snippet — fallback scoring)',
    '',
    'Open your dashboard to Unlock Intent and reply (1 credit per unlock).',
    '',
    '— Kinvox',
  ].join('\n')

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail({
      From:     'Kinvox <support@kinvoxtech.com>',
      To:       recipient,
      Subject:  'New Signal Captured — Unlock Intent in Dashboard',
      TextBody: body,
    })
    console.log(`${LOG} dispatched org=${orgId} to=${recipient} intent=${intentScore} postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${orgId} to=${recipient}: ${msg}`)
  }
}
