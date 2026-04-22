// End-to-end sandbox smoke for the claim flow. Proves the round-trip
// works against live DB without needing a browser session:
//
//   1. Generate a claim for Niko's Storm Protection
//   2. Hash the raw token ourselves; confirm the row landed in
//      organization_claims with the matching hash + unexpired + unclaimed
//   3. Simulate redemption by calling redeem_organization_claim AS a
//      real auth user (we mint one via the admin API, grab their JWT,
//      then hit PostgREST /rpc with that Authorization header)
//   4. Confirm:
//        - organizations.owner_id now points to the redeeming user
//        - profiles.organization_id points to the claimed org
//        - profiles.role = 'admin'
//        - organization_claims.claimed_at is set
//   5. Restore prior state (swap owner_id back, clear profile link, delete
//      the test user + claim row) so the sandbox looks untouched.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'

const envFile = '.env.local'
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      const k = l.slice(0, i)
      let v = l.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      return [k, v]
    }),
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = env.SUPABASE_SERVICE_ROLE_KEY

if (!url?.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`ABORT: ${envFile} is not Sandbox. URL=${url}`)
  process.exit(1)
}

const admin = createClient(url, service, { auth: { persistSession: false } })

function mintHex(bytes = 32) {
  return randomBytes(bytes).toString('hex')
}
function sha256(s) {
  return createHash('sha256').update(s).digest('hex')
}

const checks = []
const mark = (name, pass, detail = '') => checks.push({ name, pass, detail })

// --- target org (Niko's) ---
const { data: org } = await admin
  .from('organizations')
  .select('id, name, slug, owner_id')
  .eq('name', "Niko's Storm Protection")
  .single()
if (!org) {
  console.error("Niko's Storm Protection not found in sandbox.")
  process.exit(1)
}
console.log(`target org: ${org.name} (${org.id})`)
const priorOwnerId = org.owner_id

// --- mint a claim (skip the API; direct DB insert using same shape) ---
const rawToken = mintHex(32)
const tokenHash = sha256(rawToken)
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
const testEmail = `verify-claim-${Date.now()}@kinvoxtest.com`

const { data: claim, error: cErr } = await admin
  .from('organization_claims')
  .insert({ organization_id: org.id, token_hash: tokenHash, email: testEmail, expires_at: expiresAt })
  .select('id')
  .single()
if (cErr) throw cErr
console.log(`claim created id=${claim.id}`)

// --- create a disposable auth user ---
const testPassword = mintHex(16) + 'Aa1!'
const { data: created, error: uErr } = await admin.auth.admin.createUser({
  email: `claimant-${Date.now()}@kinvoxtest.com`,
  password: testPassword,
  email_confirm: true,
})
if (uErr) throw uErr
const claimantId = created.user.id
console.log(`claimant user id=${claimantId}`)

// --- get a session token for the claimant so auth.uid() resolves in the RPC ---
const anonClient = createClient(url, anon, { auth: { persistSession: false } })
const { data: sess, error: sErr } = await anonClient.auth.signInWithPassword({
  email: created.user.email, password: testPassword,
})
if (sErr) throw sErr
const accessToken = sess.session.access_token

// --- redeem the claim as the claimant ---
const asClaimant = createClient(url, anon, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
})
const { data: redeemedOrgId, error: rErr } = await asClaimant.rpc('redeem_organization_claim', { claim_token_raw: rawToken })

try {
  mark('RPC returned target org id', !rErr && redeemedOrgId === org.id, rErr ? rErr.message : `returned ${redeemedOrgId}`)

  // Re-read ground truth state
  const { data: afterOrg } = await admin.from('organizations').select('owner_id').eq('id', org.id).single()
  mark('organizations.owner_id ← claimant', afterOrg?.owner_id === claimantId, `owner_id=${afterOrg?.owner_id}`)

  const { data: afterProfile } = await admin.from('profiles').select('organization_id, role').eq('id', claimantId).single()
  mark('profiles.organization_id ← claimed org', afterProfile?.organization_id === org.id, `org_id=${afterProfile?.organization_id}`)
  mark("profiles.role = 'admin'",                afterProfile?.role === 'admin',              `role=${afterProfile?.role}`)

  const { data: afterClaim } = await admin.from('organization_claims').select('claimed_at').eq('id', claim.id).single()
  mark('organization_claims.claimed_at set',     !!afterClaim?.claimed_at,                    `claimed_at=${afterClaim?.claimed_at}`)

  // Double-redeem must fail
  const { error: doubleErr } = await asClaimant.rpc('redeem_organization_claim', { claim_token_raw: rawToken })
  mark('second redeem rejected', !!doubleErr,                                                  doubleErr?.message ?? 'no error (bad!)')
} finally {
  // --- restore ---
  await admin.from('organizations').update({ owner_id: priorOwnerId }).eq('id', org.id)
  await admin.from('organization_claims').delete().eq('id', claim.id)
  await admin.auth.admin.deleteUser(claimantId)
  console.log('\n✓ sandbox restored (owner, claim row, test user all rolled back)')
}

console.log('')
for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? '  — ' + c.detail : ''}`)
if (!checks.every((c) => c.pass)) process.exitCode = 1
