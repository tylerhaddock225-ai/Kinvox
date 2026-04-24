// POST /api/webhooks/stripe
//
// Receives Stripe events, verifies the signature, and routes
// `checkout.session.completed` into the atomic add_credits() RPC. The RPC's
// unique external_reference index is the idempotency gate — duplicate event
// deliveries return 200 OK without re-billing the tenant.
//
// Runtime: nodejs. Signature verification requires the raw request body,
// so we read via request.text() before any JSON parsing.
// Route handlers do NOT inherit (app)/layout.tsx, so this stays unauthenticated
// as Stripe expects; the shared-secret is the stripe-signature header.

import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[stripe-webhook]'

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error(`${LOG} STRIPE_WEBHOOK_SECRET is not set`)
    return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 })
  }

  // Raw body — Stripe's HMAC is computed over the exact bytes it sent. A
  // prior .json() call would mutate whitespace and break verification.
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.warn(`${LOG} signature verification failed: ${message}`)
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  // Only act on checkout completion. Everything else is acknowledged with
  // 200 so Stripe stops retrying (standard webhook contract).
  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type }, { status: 200 })
  }

  const session = event.data.object as Stripe.Checkout.Session

  // Only credit on a *paid* session. `payment_status` is 'paid' for the
  // standard cases; 'no_payment_required' also counts as fulfilled. Anything
  // else (e.g. 'unpaid' on async payment methods) waits for a later event.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return NextResponse.json(
      { received: true, ignored: `payment_status=${session.payment_status}` },
      { status: 200 },
    )
  }

  const orgId       = session.metadata?.organization_id
  const creditsRaw  = session.metadata?.credits

  if (!orgId || !creditsRaw) {
    console.error(`${LOG} session ${session.id} missing metadata.organization_id/credits`)
    return NextResponse.json({ error: 'missing_metadata' }, { status: 400 })
  }

  const credits = Number.parseInt(creditsRaw, 10)
  if (!Number.isInteger(credits) || credits <= 0) {
    console.error(`${LOG} session ${session.id} invalid credits metadata: ${creditsRaw}`)
    return NextResponse.json({ error: 'invalid_credits_metadata' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('add_credits', {
    p_org_id:  orgId,
    p_amount:  credits,
    p_ext_ref: session.id,
  })

  if (error) {
    console.error(`${LOG} add_credits failed session=${session.id} org=${orgId}: ${error.message}`)
    // 500 → Stripe retries. This is the right call for transient DB failures.
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // RPC returns a single-row table: { balance, duplicate }.
  const row = Array.isArray(data) ? data[0] : data
  const duplicate = Boolean(row?.duplicate)
  const balance   = typeof row?.balance === 'number' ? row.balance : null

  if (duplicate) {
    console.log(`${LOG} session=${session.id} org=${orgId} — duplicate, no-op`)
  } else {
    console.log(`${LOG} session=${session.id} org=${orgId} credited=${credits} new_balance=${balance}`)
  }

  return NextResponse.json({ received: true, credited: !duplicate, balance }, { status: 200 })
}
