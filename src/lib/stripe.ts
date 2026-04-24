// Shared Stripe client + credit-bundle registry.
//
// Server-only. STRIPE_SECRET_KEY is a service credential — importing this
// module from a "use client" file will fail the build, which is the intent.
// The webhook and checkout routes are the sole trusted callers.

import Stripe from 'stripe'

// Lazy-initialised singleton. `next build` imports route-handler modules to
// read their exports (runtime, dynamic, etc.), which runs module-level code.
// We can't `new Stripe('')` at import time — the constructor throws on an
// empty key. The Proxy defers construction to first real use, by which time
// STRIPE_SECRET_KEY is present or the call site is the right place to fail.
let _client: Stripe | null = null

function client(): Stripe {
  if (_client) return _client
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  _client = new Stripe(key, {
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
  })
  return _client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(client(), prop, receiver)
  },
})

// Bundle key → (Stripe price id, credit count).
//
// The browser posts a bundle KEY ('starter' | 'growth' | 'scale') to the
// checkout route; the server resolves to a price id from env. This keeps
// Stripe price ids out of the client and makes the set of purchasable
// bundles server-controlled — a client cannot request an arbitrary price.
export type BundleKey = 'starter' | 'growth' | 'scale'

export type CreditBundle = {
  key:      BundleKey
  priceId:  string
  credits:  number
  label:    string
}

const rawBundles: Array<Omit<CreditBundle, 'priceId'> & { priceId: string | undefined }> = [
  { key: 'starter', priceId: process.env.STRIPE_PRICE_STARTER, credits: 100,  label: '100 credits'  },
  { key: 'growth',  priceId: process.env.STRIPE_PRICE_GROWTH,  credits: 500,  label: '500 credits'  },
  { key: 'scale',   priceId: process.env.STRIPE_PRICE_SCALE,   credits: 2500, label: '2,500 credits' },
]

export const CREDIT_BUNDLES: CreditBundle[] = rawBundles
  .filter((b): b is CreditBundle => typeof b.priceId === 'string' && b.priceId.length > 0)

export function findBundleByKey(key: string): CreditBundle | null {
  return CREDIT_BUNDLES.find(b => b.key === key) ?? null
}

export function findBundleByPriceId(priceId: string): CreditBundle | null {
  return CREDIT_BUNDLES.find(b => b.priceId === priceId) ?? null
}
