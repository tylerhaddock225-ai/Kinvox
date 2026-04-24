// POST /api/billing/checkout
//
// Creates a Stripe Checkout Session for the authenticated tenant's active
// organization. The organization_id is derived server-side via
// resolveEffectiveOrgId — never trusted from the request body — so a
// tenant cannot buy credits for an org they don't belong to.
//
// Body: { bundle: BundleKey } | { priceId: string }
//   - bundle: preferred — keeps Stripe price ids off the client
//   - priceId: accepted for direct callers, validated against known bundles
//
// Response: { url: string } — the Stripe-hosted checkout URL.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import {
  stripe,
  findBundleByKey,
  findBundleByPriceId,
  type CreditBundle,
} from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  bundle?:  string
  priceId?: string
}

function appUrl(): string {
  // NEXT_PUBLIC_APP_URL is authoritative for tenant-facing redirects.
  // Fall back to localhost so dev servers don't 500 on misconfigured envs.
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://app.localhost:3000'
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Zero-Inference: the org comes from the server session, not the body.
  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) {
    return NextResponse.json({ error: 'no_organization' }, { status: 403 })
  }

  // Need the slug for the post-checkout redirect URLs. Billing pages
  // live at /{slug}/settings/billing after the tenant-routing migration.
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId)
    .maybeSingle<{ slug: string | null }>()

  const orgSlug = org?.slug ?? null
  if (!orgSlug) {
    return NextResponse.json({ error: 'org_slug_missing' }, { status: 409 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  let bundle: CreditBundle | null = null
  if (typeof body.bundle === 'string' && body.bundle.length > 0) {
    bundle = findBundleByKey(body.bundle)
  } else if (typeof body.priceId === 'string' && body.priceId.length > 0) {
    bundle = findBundleByPriceId(body.priceId)
  }

  if (!bundle) {
    // Either unknown key/price, or the env var wasn't set so the bundle
    // was filtered out of the registry. Either way, it's not purchasable.
    return NextResponse.json({ error: 'unknown_bundle' }, { status: 400 })
  }

  const base = appUrl()

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: bundle.priceId, quantity: 1 }],
      // Metadata is the source of truth for the webhook. Keep fields string-
      // typed per Stripe's API (it coerces everything to strings anyway).
      metadata: {
        organization_id: orgId,
        credits:         String(bundle.credits),
        bundle_key:      bundle.key,
      },
      // client_reference_id surfaces in Stripe's dashboard for easier
      // reconciliation. Metadata.organization_id remains authoritative.
      client_reference_id: orgId,
      customer_email:      user.email ?? undefined,
      success_url:         `${base}/${orgSlug}/settings/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:          `${base}/${orgSlug}/settings/billing?status=cancelled`,
      allow_promotion_codes: true,
    })

    if (!session.url) {
      return NextResponse.json({ error: 'no_checkout_url' }, { status: 502 })
    }

    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    console.error(`[billing-checkout] create failed org=${orgId} bundle=${bundle.key}: ${message}`)
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 })
  }
}
