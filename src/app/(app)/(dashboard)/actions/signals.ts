'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId, requireTenantAdmin } from '@/lib/impersonation'
import { deductCredit } from '@/lib/credits'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

export type UnlockSignalState =
  | { status: 'success' }
  | { status: 'error'; error: string; reason?: 'insufficient_credits' }
  | null

export type ApproveAndSendState =
  | { status: 'success'; external_post_id: string }
  | { status: 'error';   error: string }
  | null

export type SaveHuntingProfileState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

const MAX_REPLY_CHARS = 280 // leaves headroom over the 250-char draft cap
const WEBHOOK_TIMEOUT_MS = 10_000
const BRIDGE_RELAY_TIMEOUT_MS = 15_000  // route-handler call already has its own 10s n8n timeout

// We update + roll back with the authenticated user's session — RLS on
// pending_signals (tenant-or-HQ update policy) is the enforcement edge.
// Tenant users can only flip rows on their own org; HQ admins can flip
// anyone's (matching the resolveImpersonation pattern used elsewhere).
async function requireAuthenticated(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }
  return { ok: true as const, userId: user.id }
}

/**
 * Approves a pending signal and relays the reply through Make.com.
 *
 * Flow:
 *   1. Optimistically flip status to 'approved' with a WHERE status='pending'
 *      guard. If another click already approved it, .select().single() fails
 *      and we return a specific error — no double-send.
 *   2. POST the webhook. On success: done.
 *   3. On webhook failure: roll status back to 'pending' so the user can
 *      retry. The window between step 1 and step 3 is the only interval
 *      during which a concurrent click would see 'approved' — we accept
 *      that narrow race rather than serialising via a DB advisory lock.
 */
export async function sendSignalReply(signalId: string, text: string): Promise<State> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { status: 'error', error: auth.error }

  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return { status: 'error', error: 'Reply cannot be empty' }
  if (trimmed.length > MAX_REPLY_CHARS) {
    return { status: 'error', error: `Reply exceeds ${MAX_REPLY_CHARS} characters` }
  }

  const webhookUrl = process.env.MAKECOM_SIGNAL_REPLY_WEBHOOK_URL
  if (!webhookUrl) {
    // Fail loud rather than silently dropping the send — tenants must
    // trust "Approve & Send" actually sends.
    return { status: 'error', error: 'Reply relay is not configured' }
  }

  // Step 1: optimistic approve. The .eq('status','pending') guard makes
  // this safe against double-clicks; only the first caller wins.
  const { data: row, error: claimErr } = await supabase
    .from('pending_signals')
    .update({ status: 'approved' })
    .eq('id', signalId)
    .eq('status', 'pending')
    .select('id, organization_id, external_post_id')
    .single<{ id: string; organization_id: string; external_post_id: string | null }>()

  if (claimErr || !row) {
    return { status: 'error', error: 'Signal is not pending or is inaccessible' }
  }

  // Step 2: relay to Make.com.
  const payload = {
    action:  'post_reply',
    text:    trimmed,
    post_id: row.external_post_id,
  }

  let webhookOk = false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    })
    clearTimeout(timer)
    webhookOk = res.ok
    if (!webhookOk) {
      console.error('[sendSignalReply] webhook returned', res.status)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sendSignalReply] webhook failed:', msg)
  }

  // Step 3: if relay failed, roll back so the user can retry.
  if (!webhookOk) {
    await supabase
      .from('pending_signals')
      .update({ status: 'pending' })
      .eq('id', signalId)
      .eq('status', 'approved')        // only undo our own flip
    return { status: 'error', error: 'Reply relay failed — please try again' }
  }

  revalidatePath('/[orgSlug]/signals', 'page')
  revalidatePath('/[orgSlug]/leads', 'page')
  return { status: 'success', message: 'Reply sent.' }
}

/**
 * Drops a pending signal without contacting the poster. RLS on
 * pending_signals scopes the update to the caller's org; no further
 * guard needed.
 */
export async function dismissSignal(signalId: string): Promise<State> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { status: 'error', error: auth.error }

  const { data, error } = await supabase
    .from('pending_signals')
    .update({ status: 'dismissed' })
    .eq('id', signalId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle<{ id: string }>()

  if (error)  return { status: 'error', error: error.message }
  if (!data)  return { status: 'error', error: 'Signal is not pending or is inaccessible' }

  revalidatePath('/[orgSlug]/signals', 'page')
  return { status: 'success', message: 'Dismissed.' }
}

// ─────────────────────────────────────────────────────────────────────
// Hunting Profile (per-vertical signal_configs upsert).
//
// Tenants edit one row per (org, vertical). The form addresses the
// primary config — the oldest active row for the caller's org. If none
// exists, we INSERT one keyed to the org's vertical. The org's vertical
// is required (signal_configs.vertical is NOT NULL); orgs without a
// vertical assigned get a clean error rather than a constraint failure.
// ─────────────────────────────────────────────────────────────────────

const HUNTING_RADIUS_MIN = 5
const HUNTING_RADIUS_MAX = 500
const HUNTING_KEYWORD_MAX_LEN = 60
const HUNTING_KEYWORD_LIMIT = 25
const HUNTING_ADDRESS_MAX = 500

function parseKeywordCsv(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of raw.split(/[,\n]/)) {
    const k = piece.trim()
    if (!k) continue
    if (k.length > HUNTING_KEYWORD_MAX_LEN) continue
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
    if (out.length >= HUNTING_KEYWORD_LIMIT) break
  }
  return out
}

export async function saveHuntingProfile(
  _prev: SaveHuntingProfileState,
  formData: FormData,
): Promise<SaveHuntingProfileState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const gate = await requireTenantAdmin(
    supabase, user.id, orgId,
    'Only org admins can edit the hunting profile',
  )
  if (!gate.ok) return { status: 'error', error: gate.error }

  const officeAddressRaw = String(formData.get('office_address') ?? '').trim()
  const radiusRaw        = String(formData.get('radius_miles')   ?? '').trim()
  const keywordsRaw      = String(formData.get('keywords')       ?? '')

  if (officeAddressRaw.length > HUNTING_ADDRESS_MAX) {
    return { status: 'error', error: `Office address must be ≤ ${HUNTING_ADDRESS_MAX} characters` }
  }

  const radius = Number(radiusRaw)
  if (
    !Number.isFinite(radius) ||
    !Number.isInteger(radius) ||
    radius < HUNTING_RADIUS_MIN ||
    radius > HUNTING_RADIUS_MAX
  ) {
    return {
      status: 'error',
      error:  `Search radius must be a whole number between ${HUNTING_RADIUS_MIN} and ${HUNTING_RADIUS_MAX} miles`,
    }
  }

  const keywords = parseKeywordCsv(keywordsRaw)

  const officeAddress = officeAddressRaw === '' ? null : officeAddressRaw

  // Find the primary config (oldest active row). If none exists we
  // insert keyed to the org's vertical — that's the only field we can't
  // derive from the form alone.
  const { data: existing } = await supabase
    .from('signal_configs')
    .select('id')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existing) {
    const { error } = await supabase
      .from('signal_configs')
      .update({
        office_address: officeAddress,
        radius_miles:   radius,
        keywords,
      })
      .eq('id', existing.id)
    if (error) return { status: 'error', error: error.message }
  } else {
    const { data: org } = await supabase
      .from('organizations')
      .select('vertical')
      .eq('id', orgId)
      .single<{ vertical: string | null }>()

    if (!org?.vertical) {
      return {
        status: 'error',
        error:  'Assign a vertical to the organization before configuring hunting',
      }
    }

    const { error } = await supabase
      .from('signal_configs')
      .insert({
        organization_id: orgId,
        vertical:        org.vertical,
        office_address:  officeAddress,
        radius_miles:    radius,
        keywords,
        is_active:       true,
      })
    if (error) return { status: 'error', error: error.message }
  }

  revalidatePath('/[orgSlug]/settings/signal', 'page')
  return { status: 'success' }
}


// ─────────────────────────────────────────────────────────────────────
// Approve & Send via the n8n bridge (KINV-006/008).
//
// Replaces the legacy Make.com path used by sendSignalReply. The flow:
//
//   1. Resolve the effective org and verify the signal is unlocked +
//      ours. The Send button only renders post-unlock, so 'unlocked' is
//      the expected starting status.
//   2. INSERT outbound_messages with status='pending_approval'. This
//      doubles as the click-de-dup lock: the partial unique index
//      outbound_messages_signal_unique_per_platform makes a concurrent
//      second click fail with 23505, which we surface as a clean error.
//   3. POST /api/v1/social/reddit/reply with the new outbound id. The
//      route validates session + org again, pulls the vault token,
//      relays through n8n, and on bridge success calls
//      record_outbound_send (atomic flip + ledger debit).
//   4. Only when the route returns ok=true do we flip
//      pending_signals.status to 'approved' so the card leaves the queue.
//      A bridge failure leaves pending_signals at 'unlocked' and the
//      outbound row at 'failed' (the route does that), so the user can
//      retry without losing the unlocked state.
//
// Atomicity: the credit deduction happens inside record_outbound_send,
// which only runs after the bridge returns ok. Bridge failure ⇒ no
// charge, full stop.
// ─────────────────────────────────────────────────────────────────────

export async function approveAndSendSignal(
  signalId: string,
  text: string,
): Promise<ApproveAndSendState> {
  if (typeof signalId !== 'string' || signalId.length === 0) {
    return { status: 'error', error: 'Missing signalId' }
  }

  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return { status: 'error', error: 'Reply cannot be empty' }
  if (trimmed.length > MAX_REPLY_CHARS) {
    return { status: 'error', error: `Reply exceeds ${MAX_REPLY_CHARS} characters` }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  // Verify the signal exists, belongs to this org, and is in 'unlocked'.
  // RLS would already hide cross-tenant rows, but reading organization_id
  // explicitly lets us return distinct error codes for "missing" vs
  // "wrong tenant".
  const { data: signal } = await supabase
    .from('pending_signals')
    .select('id, organization_id, status')
    .eq('id', signalId)
    .maybeSingle<{ id: string; organization_id: string; status: string }>()

  if (!signal)                          return { status: 'error', error: 'Signal not found' }
  if (signal.organization_id !== orgId) return { status: 'error', error: 'Signal not found' }
  if (signal.status !== 'unlocked') {
    return { status: 'error', error: 'Unlock the signal before sending a reply' }
  }

  // Step 1: claim the send by inserting an outbound_messages row.
  // The partial unique index on (signal_id, platform) WHERE status IN
  // ('pending_approval','sent') is what stops double-sends — a second
  // click while one is in flight gets 23505 and we surface it cleanly.
  const { data: outbound, error: insertErr } = await supabase
    .from('outbound_messages')
    .insert({
      organization_id: orgId,
      signal_id:       signalId,
      platform:        'reddit',
      body:            trimmed,
      status:          'pending_approval',
      approved_by:     user.id,
    })
    .select('id')
    .single<{ id: string }>()

  if (insertErr || !outbound) {
    const code = (insertErr as { code?: string } | null)?.code
    if (code === '23505') {
      return { status: 'error', error: 'A reply for this signal is already in flight' }
    }
    return {
      status: 'error',
      error:  insertErr?.message ?? 'Could not queue reply for sending',
    }
  }

  // Step 2: relay to /api/v1/social/reddit/reply. We forward the user's
  // session cookies so the route's auth.getUser() sees the same caller.
  // The route owns the bridge call + atomic record_outbound_send.
  const appBase   = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000'
  const cookieJar = await cookies()
  const cookieHdr = cookieJar.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  let routeOk          = false
  let routeStatus      = 0
  let externalPostId: string | null = null
  let routeErr:        string | null = null

  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), BRIDGE_RELAY_TIMEOUT_MS)
    const res = await fetch(`${appBase}/api/v1/social/reddit/reply`, {
      method:  'POST',
      headers: {
        'content-type': 'application/json',
        cookie:         cookieHdr,
      },
      body:    JSON.stringify({ outbound_message_id: outbound.id }),
      signal:  controller.signal,
      cache:   'no-store',
    })
    clearTimeout(timer)
    routeStatus = res.status

    let payload:
      | { ok?: boolean; external_post_id?: string; error?: string; detail?: string }
      | null = null
    try { payload = await res.json() } catch { /* leave null */ }

    if (res.ok && payload?.ok && typeof payload.external_post_id === 'string') {
      routeOk        = true
      externalPostId = payload.external_post_id
    } else {
      routeErr = payload?.detail ?? payload?.error ?? `bridge_status_${res.status}`
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    routeErr = aborted ? 'bridge_timeout' : err instanceof Error ? err.message : String(err)
  }

  if (!routeOk || !externalPostId) {
    // The route already marked outbound_messages.status='failed' on its
    // failure path. Nothing else to clean up here — pending_signals stays
    // 'unlocked', so the user can retry. No credit was charged.
    void routeStatus // referenced for the error string below
    return {
      status: 'error',
      error:  routeErr ?? 'Reply relay failed — please try again',
    }
  }

  // Step 3: bridge accepted + ledger debited (inside the route). Move the
  // signal off the queue. Guarded by status='unlocked' so a concurrent
  // dismiss can't be silently overwritten.
  const { error: flipErr } = await supabase
    .from('pending_signals')
    .update({ status: 'approved' })
    .eq('id', signalId)
    .eq('status', 'unlocked')

  if (flipErr) {
    // Reply was sent + credit charged. The card may stick around in the
    // queue until realtime/refresh — surface a soft warning rather than
    // a hard error so the user knows the send itself worked.
    console.error('[approveAndSendSignal] post-send status flip failed', flipErr)
  }

  revalidatePath('/[orgSlug]/signals', 'page')
  revalidatePath('/[orgSlug]/leads', 'page')
  return { status: 'success', external_post_id: externalPostId }
}


// ─────────────────────────────────────────────────────────────────────
// Pay-on-Unlock for signals.
// ─────────────────────────────────────────────────────────────────────

// Atomically charges 1 credit and reveals a pending signal's raw_text +
// ai_draft_reply. Mirrors the unlockLead pattern from Sprint 2 — same
// idempotency story, same Zero-Inference org resolution.
//
// Idempotency:
//   - If status is already 'unlocked' (or anything non-pending), no-op.
//   - On a concurrent race past the status check, the partial unique
//     index credit_ledger_signal_dedup raises 23505 inside deduct_credit.
//     The RPC's transaction rolls back the balance decrement, so the
//     second caller is treated as already-paid. The status flip is
//     scoped to status='pending', so only one of the racers writes
//     unlocked_at / unlocked_by.
export async function unlockSignal(signalId: string): Promise<UnlockSignalState> {
  if (typeof signalId !== 'string' || signalId.length === 0) {
    return { status: 'error', error: 'Missing signalId' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  // Re-resolve the signal server-side and verify ownership. RLS would also
  // hide cross-tenant rows, but reading organization_id explicitly lets us
  // distinguish wrong-tenant from missing in error responses.
  const { data: signal } = await supabase
    .from('pending_signals')
    .select('id, organization_id, status')
    .eq('id', signalId)
    .maybeSingle<{ id: string; organization_id: string; status: string }>()

  if (!signal)                          return { status: 'error', error: 'Signal not found' }
  if (signal.organization_id !== orgId) return { status: 'error', error: 'Signal not found' }
  if (signal.status !== 'pending')      return { status: 'success' }

  // Charge first, reveal second. The partial unique index makes deduct
  // idempotent on retry, so a half-completed unlock can be re-tried
  // without double-billing.
  let chargeResult: Awaited<ReturnType<typeof deductCredit>>
  try {
    chargeResult = await deductCredit(orgId, 1, signal.id)
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code !== '23505') {
      const msg = err instanceof Error ? err.message : 'Unlock failed'
      return { status: 'error', error: msg }
    }
    chargeResult = { ok: true, balance: 0 }   // already-charged via the dedup index
  }

  if (!chargeResult.ok) {
    return {
      status: 'error',
      error:  'Insufficient credits — top up to unlock this signal.',
      reason: 'insufficient_credits',
    }
  }

  // Atomic flip scoped to status='pending' so a concurrent winner doesn't
  // get its unlocked_at overwritten by ours. Zero rows affected is OK —
  // the credit was idempotently charged and the signal is unlocked one
  // way or the other.
  const { error: updErr } = await supabase
    .from('pending_signals')
    .update({
      status:      'unlocked',
      unlocked_at: new Date().toISOString(),
      unlocked_by: user.id,
    })
    .eq('id', signal.id)
    .eq('status', 'pending')

  if (updErr) {
    return { status: 'error', error: 'Unlock half-completed — refresh and try again.' }
  }

  revalidatePath('/[orgSlug]/signals', 'page')
  return { status: 'success' }
}
