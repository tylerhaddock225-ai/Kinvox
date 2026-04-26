// One-shot: configure a sandbox org as the Moore, OK storm-shelter triage catcher.
// Usage: node --env-file=.env.local scripts/seed-storm-shelter-org.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
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

const PREFERRED_SLUG = 'kinvox'

let { data: target, error: lookupErr } = await admin
  .from('organizations')
  .select('id, slug, name, vertical, status, latitude, longitude, signal_radius')
  .eq('slug', PREFERRED_SLUG)
  .maybeSingle()
if (lookupErr) { console.error('lookup failed:', lookupErr.message); process.exit(1) }

if (!target) {
  console.log(`no org with slug "${PREFERRED_SLUG}" — falling back to first available org.`)
  const { data: firstRow, error: fbErr } = await admin
    .from('organizations')
    .select('id, slug, name, vertical, status, latitude, longitude, signal_radius')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (fbErr) { console.error('fallback lookup failed:', fbErr.message); process.exit(1) }
  if (!firstRow) { console.error('no organizations exist in this project — aborting.'); process.exit(1) }
  target = firstRow
}

console.log('Target organization (before update):')
console.log(target)

const { data: updated, error: updErr } = await admin
  .from('organizations')
  .update({
    vertical: 'storm_shelter',
    status: 'active',
    latitude: 35.3395,
    longitude: -97.4867,
    signal_radius: 50,
  })
  .eq('id', target.id)
  .select('id, slug, name, vertical, status, latitude, longitude, signal_radius')
  .single()
if (updErr) { console.error('update failed:', updErr.message); process.exit(1) }

console.log('')
console.log('Target organization (after update):')
console.log(updated)

const ok =
  updated.vertical === 'storm_shelter' &&
  updated.status === 'active' &&
  updated.latitude === 35.3395 &&
  updated.longitude === -97.4867 &&
  updated.signal_radius === 50

console.log('')
console.log(ok ? 'verification: OK — all fields match.' : 'verification: MISMATCH — inspect output above.')
process.exit(ok ? 0 : 1)
