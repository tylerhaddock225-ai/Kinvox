'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

const MAX_REPLY_CHARS = 280 // leaves headroom over the 250-char draft cap
const WEBHOOK_TIMEOUT_MS = 10_000

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
