// POST /api/v1/social/reddit/reply
//
// "Approve & Send" writer for Reddit. The browser submits an
// outbound_message id; we resolve the org's stored Reddit credential
// bundle from Vault and relay the send through the centralized n8n
// bridge. n8n owns the actual Reddit HTTP call (and any future
// token-refresh dance), so this route becomes a thin verifier:
//
//   1. Authenticate the caller's session and resolve the effective org
//      via resolveEffectiveOrgId() — the org id is NEVER trusted from
//      the request body (Zero-Inference).
//   2. Load the outbound_messages row, verify ownership + status.
//   3. Pull the JSON token bundle through get_decrypted_credential
//      (SECURITY DEFINER, service_role only).
//   4. POST the relay payload to N8N_REDDIT_BRIDGE_URL with the shared
//      X-Kinvox-Bridge-Secret header.
//   5. On a 200 with reddit_post_id, atomically flip the outbound row
//      to 'sent' and deduct 1 credit via record_outbound_send (using
//      outbound_messages.id as the ledger reference_id).
//
// Failure modes:
//   - Bridge non-2xx, timeout, missing reddit_post_id, or malformed
//     response → outbound_messages.status='failed' with error_message,
//     and a 502 bubbles up. No credit is charged.
//   - Bridge 2xx but record_outbound_send fails → 500 with
//     {sent_to_reddit:true} so the UI can show "sent but bookkeeping
//     failed" — never auto-retry the bridge or we'd double-comment.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId } from '@/lib/impersonation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BRIDGE_TIMEOUT_MS = 10_000

type Payload = { outbound_message_id?: string }

type OutboundRow = {
  id:               string
  organization_id:  string
  signal_id:        string
  platform:         'reddit' | 'x' | 'facebook' | 'threads'
  body:             string
  status:           'draft' | 'pending_approval' | 'sent' | 'failed'
}

// Shape returned by the n8n workflow's "Respond to Webhook" node.
// success → { ok:true, reddit_post_id:'t1_xxxxxx' }
// failure → { ok:false, error:'rate_limited' | 'auth_expired' | ... }
type BridgeResponse = {
  ok?:             boolean
  reddit_post_id?: string
  error?:          string
}

// What we expect inside vault.decrypted_secret after KINV-004's OAuth
// callback persisted the bundle. Older rows (if any) are plain strings
// and get wrapped into { access_token } below for the bridge.
type RedditTokenBundle = {
  access_token:   string
  refresh_token?: string | null
  expires_at?:    string | null
  scope?:         string | null
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status })
}

export async function POST(request: NextRequest) {
  const bridgeUrl    = process.env.N8N_REDDIT_BRIDGE_URL?.trim()
  const bridgeSecret = process.env.N8N_BRIDGE_SECRET?.trim()
  if (!bridgeUrl || !bridgeSecret) {
    return json({ error: 'bridge_not_configured' }, 503)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'not_authenticated' }, 401)

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return json({ error: 'no_organization' }, 403)

  let body: Payload
  try {
    body = (await request.json()) as Payload
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const outboundId =
    typeof body.outbound_message_id === 'string' ? body.outbound_message_id.trim() : ''
  if (!outboundId) return json({ error: 'outbound_message_id is required' }, 400)

  const admin = createAdminClient()

  // Resolve the outbound row + its parent signal via the admin client so
  // we can return distinct error codes for "wrong tenant" vs "missing".
  // RLS would already hide cross-tenant rows from a user-scoped read.
  const { data: outbound } = await admin
    .from('outbound_messages')
    .select('id, organization_id, signal_id, platform, body, status')
    .eq('id', outboundId)
    .maybeSingle<OutboundRow>()

  if (!outbound)                              return json({ error: 'outbound_not_found' }, 404)
  if (outbound.organization_id !== orgId)     return json({ error: 'outbound_not_found' }, 404)
  if (outbound.platform !== 'reddit')         return json({ error: 'platform_mismatch' }, 400)
  if (outbound.status === 'sent')             return json({ ok: true, idempotent: true })
  if (outbound.status !== 'pending_approval') return json({ error: `bad_status:${outbound.status}` }, 409)

  // pending_signals.external_post_id holds the canonical Reddit post URL.
  // Extract the t3_<base36> "thing id" the comment endpoint expects.
  const { data: signal } = await admin
    .from('pending_signals')
    .select('external_post_id')
    .eq('id', outbound.signal_id)
    .maybeSingle<{ external_post_id: string | null }>()

  const parentThingId = parseRedditThingId(signal?.external_post_id ?? null)
  if (!parentThingId) return json({ error: 'parent_post_id_unresolvable' }, 422)

  // Pull the credential through the SECURITY DEFINER vault wrapper.
  // RPC return type is inferred from Database['public']['Functions'].
  const { data: rawToken, error: credErr } = await admin
    .rpc('get_decrypted_credential', { p_org_id: orgId, p_platform: 'reddit' })

  if (credErr || !rawToken || typeof rawToken !== 'string') {
    return json({ error: 'reddit_not_connected', detail: credErr?.message }, 412)
  }

  // KINV-004 stores the bundle as JSON. Pre-KINV-004 rows (if any) are
  // plain bearer strings — wrap those so n8n always receives the same
  // shape and doesn't need to special-case the legacy format.
  const tokenBundle = parseTokenBundle(rawToken)
  if (!tokenBundle) {
    await markFailed(admin, outboundId, 'malformed_token_bundle')
    return json({ error: 'malformed_token_bundle' }, 500)
  }

  // ── Relay to n8n ─────────────────────────────────────────────────────
  let bridgeResp: BridgeResponse | null = null
  let bridgeErr:  string | null = null
  let bridgeStatus = 0

  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS)

    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'content-type':           'application/json',
        'x-kinvox-bridge-secret': bridgeSecret,
      },
      body: JSON.stringify({
        org_id:               orgId,
        outbound_id:          outboundId,
        reddit_token_bundle:  tokenBundle,
        parent_thing_id:      parentThingId,
        message_body:         outbound.body,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    bridgeStatus = res.status

    try {
      bridgeResp = (await res.json()) as BridgeResponse
    } catch {
      bridgeErr = `bridge_invalid_json_status_${res.status}`
    }

    if (!res.ok) {
      bridgeErr ??= bridgeResp?.error ?? `bridge_http_${res.status}`
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    bridgeErr = aborted ? 'bridge_timeout' : err instanceof Error ? err.message : String(err)
  }

  const redditPostId = bridgeResp?.reddit_post_id ?? null
  if (!redditPostId) {
    const detail = bridgeErr ?? bridgeResp?.error ?? `bridge_status_${bridgeStatus}`
    await markFailed(admin, outboundId, detail)
    return json({ error: 'reddit_send_failed', detail }, 502)
  }

  // ── Atomic flip-to-sent + ledger deduction ───────────────────────────
  // The outbound id is the ledger reference; a retry that races the same
  // row is a no-op because record_outbound_send detects status='sent'
  // and returns null without re-charging.
  const { error: recordErr } = await admin.rpc('record_outbound_send', {
    p_outbound_id:      outboundId,
    p_external_post_id: redditPostId,
    p_charge:           1,
  })

  if (recordErr) {
    console.error('[reddit/reply] record_outbound_send failed', recordErr)
    return json(
      {
        ok:               false,
        sent_to_reddit:   true,
        external_post_id: redditPostId,
        error:            'ledger_record_failed',
      },
      500,
    )
  }

  return json({ ok: true, external_post_id: redditPostId })
}

// Reddit URLs look like https://reddit.com/r/foo/comments/abc123/title/.
// The "thing id" we reply to is t3_<base36>. Returns null if we can't parse.
function parseRedditThingId(input: string | null): string | null {
  if (!input) return null
  const m = input.match(/\/comments\/([a-z0-9]+)/i)
  return m ? `t3_${m[1]}` : null
}

// KINV-004's OAuth callback persists JSON; legacy callers may have stored
// a plain bearer string. Normalize both to RedditTokenBundle so the n8n
// payload shape is stable. Returns null if neither shape is recoverable.
function parseTokenBundle(raw: string): RedditTokenBundle | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<RedditTokenBundle>
      if (typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
        return {
          access_token:  parsed.access_token,
          refresh_token: parsed.refresh_token ?? null,
          expires_at:    parsed.expires_at ?? null,
          scope:         parsed.scope ?? null,
        }
      }
      return null
    } catch {
      return null
    }
  }

  // Legacy format: opaque bearer string. Wrap and forward.
  return { access_token: trimmed, refresh_token: null, expires_at: null, scope: null }
}

async function markFailed(
  admin: ReturnType<typeof createAdminClient>,
  outboundId: string,
  reason: string,
) {
  await admin
    .from('outbound_messages')
    .update({ status: 'failed', error_message: reason })
    .eq('id', outboundId)
    .eq('status', 'pending_approval')
}
