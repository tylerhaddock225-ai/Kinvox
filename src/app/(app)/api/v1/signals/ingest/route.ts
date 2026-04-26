// POST /api/v1/signals/ingest
//
// Global, multi-tenant intake for AI social-listening workers (Reddit-first).
// Unlike /api/v1/signals/capture — which is per-tenant and authed by an
// organization API key — this route is HQ-scoped. A single source post
// (one Reddit URL) gets fanned out to every active organization in the
// matching vertical whose geofence contains the signal's coordinates.
//
// Auth: x-kinvox-ingest-key (matched against env INGEST_API_KEY). Tenant
// org IDs are NEVER read from headers — attribution is derived purely
// from vertical + geofence containment.
//
// Dedup: enforced at the DB layer by a partial unique index on
// (organization_id, external_post_id). The same URL legitimately fans
// out to N orgs on first pass; re-emission of the same URL by the
// upstream worker becomes a per-org no-op. We use upsert with
// ignoreDuplicates so a partial re-run still completes for the orgs
// that hadn't received it yet.

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMiles } from '@/lib/geo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Payload = {
  title?:     string
  body?:      string
  author?:    string
  url?:       string
  vertical?:  string
  latitude?:  number
  longitude?: number
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

  // Coordinates are optional. When absent, the geofence step degrades to
  // a vertical-only broadcast — matching the spec's "if present" wording.
  const sigLat = typeof body.latitude  === 'number' && Number.isFinite(body.latitude)  ? body.latitude  : null
  const sigLng = typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : null

  const admin = createAdminClient()

  // ── Dedup short-circuit ─────────────────────────────────────────────
  // The (organization_id, external_post_id) partial unique index is the
  // hard guarantee, but we look up first to (a) return a meaningful
  // response when an upstream worker retries, and (b) avoid spending a
  // round-trip building the fan-out set when the URL has already been
  // distributed.
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

  // ── Triage: candidate orgs ──────────────────────────────────────────
  // Active = not soft-deleted, status='active', listening enabled, and
  // matched on the canonical vertical slug. We pull the geofence columns
  // here rather than in a SQL function because the radius check is mile-
  // based (Haversine) and PostGIS isn't enabled on this project.
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
    // Geofence is only enforced when BOTH sides have coordinates. An org
    // without lat/lng/radius opts into vertical-wide capture; a signal
    // without coords cannot be filtered geographically. Either gap → match.
    const orgHasGeo =
      org.latitude !== null && org.longitude !== null && org.signal_radius !== null
    const sigHasGeo = sigLat !== null && sigLng !== null

    if (!orgHasGeo || !sigHasGeo) {
      matched.push(org)
      continue
    }

    const miles = haversineMiles(
      sigLat as number,
      sigLng as number,
      org.latitude  as number,
      org.longitude as number,
    )
    if (miles <= (org.signal_radius as number)) {
      matched.push(org)
    }
  }

  if (matched.length === 0) {
    return json({
      ok:           true,
      matched:      0,
      inserted:     0,
      reason:       'no_orgs_in_geofence',
      vertical,
      candidates:   candidates.length,
    })
  }

  // Compose the canonical raw_text from title + body so the dashboard
  // teaser has something coherent to render. Author is appended as a
  // lightweight attribution line — no separate column for it on
  // pending_signals.
  const rawText = [
    title,
    postBody,
    author ? `— u/${author}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()

  const rows = matched.map((org) => ({
    organization_id:  org.id,
    raw_text:         rawText,
    platform:         'reddit',
    status:           'pending' as const,
    external_post_id: url,
  }))

  // ignoreDuplicates lets a retry re-fire safely: orgs that were already
  // covered are skipped by the partial unique index, new candidates land.
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
    organization_ids: (inserted ?? []).map((r) => r.organization_id),
    signal_ids:       (inserted ?? []).map((r) => r.id),
  })
}
