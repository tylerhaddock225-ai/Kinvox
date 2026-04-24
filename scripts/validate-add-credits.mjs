// One-off atomicity check for the add_credits RPC against the linked
// sandbox Supabase project. Run with:
//   node --env-file=.env.local scripts/validate-add-credits.mjs
//
// - Picks the first non-deleted organization with a credits row.
// - Reads current balance.
// - Calls add_credits(org, 1, ext) → expects { balance: B+1, duplicate: false }.
// - Calls again with same ext → expects { balance: B+1, duplicate: true }.
// - Verifies final balance is B+1 (not B+2).
// - Cleans up: deletes the test ledger row and rolls the balance back to B.

import { createClient } from '@supabase/supabase-js'

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!url.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`refusing to run: URL ${url} is not the sandbox project`)
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const extRef = `test_atomicity_${Date.now()}`

function fail(msg, extra) {
  console.error('FAIL:', msg, extra ?? '')
  process.exit(1)
}

// 1. Pick an org
const { data: orgs, error: orgErr } = await admin
  .from('organizations')
  .select('id, name')
  .is('deleted_at', null)
  .limit(1)
if (orgErr) fail('org lookup failed', orgErr.message)
if (!orgs?.length) fail('no organizations in sandbox')
const org = orgs[0]
console.log(`org: ${org.id} (${org.name})`)

// 2. Read current balance
const { data: before, error: beforeErr } = await admin
  .from('organization_credits')
  .select('balance')
  .eq('organization_id', org.id)
  .maybeSingle()
if (beforeErr) fail('balance read failed', beforeErr.message)
const balanceBefore = before?.balance ?? 0
console.log(`balance before: ${balanceBefore}`)

// 3. First call — expect inserted
const { data: firstRows, error: firstErr } = await admin.rpc('add_credits', {
  p_org_id:  org.id,
  p_amount:  1,
  p_ext_ref: extRef,
})
if (firstErr) fail('first add_credits failed', firstErr.message)
const first = Array.isArray(firstRows) ? firstRows[0] : firstRows
console.log(`first call  : balance=${first?.balance} duplicate=${first?.duplicate}`)
if (first?.duplicate !== false)       fail('first call should not be a duplicate')
if (first?.balance  !== balanceBefore + 1) fail(`first call balance wrong; expected ${balanceBefore + 1}`)

// 4. Second call with same ext_ref — expect duplicate
const { data: dupRows, error: dupErr } = await admin.rpc('add_credits', {
  p_org_id:  org.id,
  p_amount:  1,
  p_ext_ref: extRef,
})
if (dupErr) fail('duplicate add_credits failed', dupErr.message)
const dup = Array.isArray(dupRows) ? dupRows[0] : dupRows
console.log(`second call : balance=${dup?.balance} duplicate=${dup?.duplicate}`)
if (dup?.duplicate !== true) fail('second call should be a duplicate')
if (dup?.balance  !== balanceBefore + 1) fail(`second call balance wrong; expected ${balanceBefore + 1}`)

// 5. Verify ledger has exactly one purchase row with this ext_ref
const { data: ledgerRows, error: ledgerErr } = await admin
  .from('credit_ledger')
  .select('id, amount, type, external_reference')
  .eq('external_reference', extRef)
if (ledgerErr) fail('ledger read failed', ledgerErr.message)
console.log(`ledger rows : ${ledgerRows?.length ?? 0}`)
if (ledgerRows?.length !== 1)               fail('expected exactly 1 ledger row for ext_ref')
if (ledgerRows[0].type   !== 'purchase')    fail('ledger row type should be purchase')
if (ledgerRows[0].amount !== 1)             fail('ledger row amount should be +1')

// 6. Cleanup — remove test row and revert balance
const { error: delErr } = await admin
  .from('credit_ledger')
  .delete()
  .eq('external_reference', extRef)
if (delErr) fail('cleanup delete failed', delErr.message)

const { error: revErr } = await admin
  .from('organization_credits')
  .update({ balance: balanceBefore })
  .eq('organization_id', org.id)
if (revErr) fail('cleanup revert failed', revErr.message)

const { data: after } = await admin
  .from('organization_credits')
  .select('balance')
  .eq('organization_id', org.id)
  .maybeSingle()
console.log(`balance after cleanup: ${after?.balance}`)
if (after?.balance !== balanceBefore) fail('cleanup did not restore balance')

console.log('\nPASS: add_credits is atomic and idempotent.')
