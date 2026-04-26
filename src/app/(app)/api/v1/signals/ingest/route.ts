// POST /api/v1/signals/ingest
//
// Global, multi-tenant intelligent intake (Reddit-first). The caller (n8n)
// sends raw post text only — no coordinates, no organization id. The route:
//
//   1. Authenticates the caller (HQ-scoped INGEST_API_KEY).
//   2. Validates `vertical` against the public.verticals lookup.
//   3. Short-circuits on duplicate URLs (also DB-enforced via partial
//      unique index on pending_signals(organization_id, external_post_id)).
//   4. Runs ONE Anthropic call (triageSignal) to extract:
//        intent_score (1/3/6), reasoning_snippet, summary,
//        location_name, latitude, longitude.
//   5. Drops the signal if intent_score < 6 (low-/medium-intent noise) or
//      no usable coordinates were extracted.
//   6. Fans out: pulls all active orgs in the vertical, runs Haversine
//      against the AI's coords, inserts one pending_signals row per
//      org whose signal_radius covers the point. AI-extracted fields
//      land in the new metadata jsonb column.
//
// Zero-Inference: organization routing is derived strictly from the AI's
// geographic extraction. The caller cannot pass organization_id, latitude,
// or longitude — those keys, if present, are ignored.

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMiles } from '@/lib/geo'
import { triageSignal } from '@/lib/ai/intent-scorer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Payload = {
  title?:    string
  body?:     string
  author?:   string
  url?:      string
  vertical?: string
}

type OrgRow = {
  id:             string
  latitude:       number | null
  longitude:      number | null
  signal_radius:  number | null
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

export async function POST(request: NextRequest) {
  const expected = process.env.INGEST_API_KEY?.trim()
  if (!expected) {
    return json({ error: 'ingest_key_not_configured' }, 503)
  }
  const provided = request.headers.get('x-kinvox-ingest-key')?.trim()
  if (!provided || provided !== expected) {
    return json({ error: 'invalid_api_key' }, 401)
  }

  let body: Payload
  try {
    body = (await request.json()) as Payload
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const title    = typeof body.title    === 'string' ? body.title.trim()    : ''
  const postBody = typeof body.body     === 'string' ? body.body.trim()     : ''
  const author   = typeof body.author   === 'string' ? body.author.trim()   : ''
  const url      = typeof body.url      === 'string' ? body.url.trim()      : ''
  const vertical = typeof body.vertical === 'string' ? body.vertical.trim() : ''

  if (!url)      return json({ error: 'url is required' },      400)
  if (!vertical) return json({ error: 'vertical is required' }, 400)
  if (!title && !postBody) {
    return json({ error: 'title or body is required' }, 400)
  }

  const admin = createAdminClient()

  // ── Vertical registry pre-check ─────────────────────────────────────
  // The FK on organizations/signal_configs would also reject an unknown
  // vertical at INSERT time, but a pre-check returns a cleaner 400 +
  // doesn't burn an LLM call on a payload we'll never persist.
  const { data: verticalRow, error: verticalErr } = await admin
    .from('verticals')
    .select('id, is_active')
    .eq('id', vertical)
    .maybeSingle<{ id: string; is_active: boolean }>()

  if (verticalErr) {
    return json({ error: `vertical_lookup_failed: ${verticalErr.message}` }, 500)
  }
  if (!verticalRow) {
    return json({ error: 'unknown_vertical', vertical }, 400)
  }
  if (!verticalRow.is_active) {
    return json({ error: 'vertical_inactive', vertical }, 400)
  }

  // ── Dedup short-circuit ─────────────────────────────────────────────
  // Hard guarantee is the partial unique index on
  // (organization_id, external_post_id). Look up first to give the caller
  // a friendly response and avoid spending an LLM call on a known URL.
  const { data: existing, error: existingErr } = await admin
    .from('pending_signals')
    .select('id, organization_id')
    .eq('external_post_id', url)

  if (existingErr) {
    return json({ error: `dedup_lookup_failed: ${existingErr.message}` }, 500)
  }

  if (existing && existing.length > 0) {
    return json({
      ok:               true,
      deduplicated:     true,
      already_ingested: existing.length,
      organization_ids: existing.map((r) => r.organization_id),
    })
  }

  // ── Single LLM call: intent + geo extraction ────────────────────────
  const triage = await triageSignal({
    platform:      'reddit',
    title,
    body:          postBody,
    author_handle: author || undefined,
  })

  // ── Intent gate ─────────────────────────────────────────────────────
  // <6 = browse / need but not urgent. We drop these to keep noise out
  // of merchant dashboards. The caller still gets a clean 200 so n8n
  // doesn't retry.
  if (triage.intent_score < 6) {
    return json({
      ok:           true,
      gated:        true,
      reason:       'low_intent',
      intent_score: triage.intent_score,
      summary:      triage.summary,
    })
  }

  // ── Geo gate ────────────────────────────────────────────────────────
  // No usable coords from the model → no triage possible. Falling back
  // to vertical-broadcast would defeat the geofence entirely, so we drop.
  if (triage.latitude === null || triage.longitude === null) {
    return json({
      ok:            true,
      gated:         true,
      reason:        'no_location_extracted',
      intent_score:  triage.intent_score,
      location_name: triage.location_name,
    })
  }

  const sigLat = triage.latitude
  const sigLng = triage.longitude

  // ── Org fan-out ─────────────────────────────────────────────────────
  // Active = listening on, not soft-deleted, status='active', vertical match.
  // Geofence requires lat+lng+radius on the org row; orgs without geo
  // configured are excluded (they have no way to define their service area).
  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, latitude, longitude, signal_radius')
    .eq('vertical', vertical)
    .eq('status', 'active')
    .eq('ai_listening_enabled', true)
    .is('deleted_at', null)
    .returns<OrgRow[]>()

  if (orgErr) {
    return json({ error: `org_lookup_failed: ${orgErr.message}` }, 500)
  }

  const candidates = orgs ?? []
  const matched: OrgRow[] = []

  for (const org of candidates) {
    if (org.latitude === null || org.longitude === null || org.signal_radius === null) continue
    const miles = haversineMiles(sigLat, sigLng, org.latitude, org.longitude)
    if (miles <= org.signal_radius) {
      matched.push(org)
    }
  }

  if (matched.length === 0) {
    return json({
      ok:            true,
      matched:       0,
      inserted:      0,
      reason:        'no_orgs_in_geofence',
      vertical,
      candidates:    candidates.length,
      intent_score:  triage.intent_score,
      location_name: triage.location_name,
      latitude:      sigLat,
      longitude:     sigLng,
    })
  }

  // raw_text we persist is the canonical post body we got. Author is
  // appended as a lightweight attribution line — pending_signals has no
  // dedicated author column.
  const rawText = [
    title,
    postBody,
    author ? `— u/${author}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()

  const metadata = {
    location_name:   triage.location_name,
    summary:         triage.summary,
    extracted_lat:   sigLat,
    extracted_lng:   sigLng,
    pii_redacted:    triage.pii_redacted,
    scoring_skipped: triage.scoring_skipped,
  }

  const rows = matched.map((org) => ({
    organization_id:   org.id,
    raw_text:          rawText,
    platform:          'reddit',
    status:            'pending' as const,
    external_post_id:  url,
    intent_score:      triage.intent_score,
    reasoning_snippet: triage.reasoning_snippet,
    metadata,
  }))

  // ignoreDuplicates lets a retry re-fire safely: orgs already covered
  // are skipped by the partial unique index, new candidates land.
  const { data: inserted, error: insertErr } = await admin
    .from('pending_signals')
    .upsert(rows, {
      onConflict:       'organization_id,external_post_id',
      ignoreDuplicates: true,
    })
    .select('id, organization_id')

  if (insertErr) {
    return json({ error: `insert_failed: ${insertErr.message}` }, 500)
  }

  return json({
    ok:               true,
    matched:          matched.length,
    inserted:         inserted?.length ?? 0,
    candidates:       candidates.length,
    intent_score:     triage.intent_score,
    location_name:    triage.location_name,
    latitude:         sigLat,
    longitude:        sigLng,
    organization_ids: (inserted ?? []).map((r) => r.organization_id),
    signal_ids:       (inserted ?? []).map((r) => r.id),
  })
}
