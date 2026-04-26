// Verification: exercise the exact onConflict spec the ingest route uses.
// If upsert succeeds, the unique index is present AND inferable (which means
// it is non-partial — a partial index would fail conflict-target inference
// the same way the old one did).
//
// Usage: node --env-file=.env.local scripts/verify-pending-signals-uniq.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('missing env'); process.exit(1) }
if (!url.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`refusing to run against ${url}`); process.exit(1)
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const ORG_ID = '5d3f6e08-4e48-4913-a429-350a0875fe9d' // Kinvox Sandbox HQ (Moore)
const PROBE_URL = `https://verify.local/probe/${Date.now()}`

const baseRow = {
  organization_id:  ORG_ID,
  raw_text:         'verify-pending-signals-uniq probe',
  platform:         'reddit',
  status:           'pending',
  external_post_id: PROBE_URL,
  intent_score:     6,
  reasoning_snippet:'verification probe',
  metadata:         { probe: true },
}

console.log(`probe url: ${PROBE_URL}`)
console.log('step 1 — initial upsert (insert path)...')
const r1 = await admin
  .from('pending_signals')
  .upsert([baseRow], { onConflict: 'organization_id,external_post_id', ignoreDuplicates: true })
  .select('id')
if (r1.error) { console.error('step 1 FAILED:', r1.error.message); process.exit(1) }
console.log(`  ok — inserted id=${r1.data?.[0]?.id ?? '(deduped)'}`)

console.log('step 2 — re-upsert same key (must be a no-op, not an error)...')
const r2 = await admin
  .from('pending_signals')
  .upsert([baseRow], { onConflict: 'organization_id,external_post_id', ignoreDuplicates: true })
  .select('id')
if (r2.error) { console.error('step 2 FAILED:', r2.error.message); process.exit(1) }
console.log(`  ok — returned ${r2.data?.length ?? 0} row(s) (0 = ignoreDuplicates respected)`)

console.log('step 3 — cleanup...')
const r3 = await admin
  .from('pending_signals')
  .delete()
  .eq('organization_id', ORG_ID)
  .eq('external_post_id', PROBE_URL)
if (r3.error) { console.error('cleanup failed (probe row may persist):', r3.error.message); process.exit(1) }
console.log('  ok')

console.log('')
console.log('verification: PASS — index exists, is non-partial, and onConflict is inferable.')
