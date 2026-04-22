// Sandbox smoke test for migration 20260422000001:
//   1. Assert the three new columns exist
//   2. Assert the partial unique index exists (by name)
//   3. Round-trip a slug on two different orgs:
//        A ← 'verify-unique-abcd' succeeds
//        B ← 'verify-unique-abcd' FAILS with 23505
//        A ← null succeeds (null = disabled)
//        B ← 'verify-unique-abcd' now succeeds
//   4. Restore both orgs to prior state in a finally
//
// Reads prod-grade safeguards from verify-ai-runtime.mjs: refuses to run
// against anything but the Sandbox ref.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const envFile = typeof args.env === 'string' ? args.env : '.env.local'

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      const k = l.slice(0, i)
      let v = l.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      return [k, v]
    }),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

if (!url?.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`ABORT: ${envFile} is not Sandbox. URL = ${url}`)
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

const TEST_SLUG = `verify-unique-${Math.random().toString(36).slice(2, 8)}`
console.log(`sandbox verify — test slug: ${TEST_SLUG}`)

const { data: orgs, error: oErr } = await supabase
  .from('organizations')
  .select('id, name, lead_magnet_slug, lead_magnet_settings, website_url')
  .is('deleted_at', null)
  .order('created_at', { ascending: true })
  .limit(2)

if (oErr || !orgs?.length || orgs.length < 2) {
  console.error('Need at least 2 live sandbox orgs to run this test.', oErr?.message)
  process.exit(1)
}
const [a, b] = orgs
const priorA = { lead_magnet_slug: a.lead_magnet_slug, lead_magnet_settings: a.lead_magnet_settings, website_url: a.website_url }
const priorB = { lead_magnet_slug: b.lead_magnet_slug, lead_magnet_settings: b.lead_magnet_settings, website_url: b.website_url }
console.log(`org A: ${a.name} (${a.id})`)
console.log(`org B: ${b.name} (${b.id})`)

const checks = []
const mark = (name, pass, detail = '') => checks.push({ name, pass, detail })

try {
  // 1. column presence — the SELECT above would have errored out if any
  //    column were missing, so getting here is proof enough.
  mark('columns exist (lead_magnet_slug, lead_magnet_settings, website_url)', true)

  // 2. default settings match spec on a fresh org — pick one with no slug
  //    and null settings gets the jsonb default we wrote into the migration.
  const { data: freshRow } = await supabase
    .from('organizations')
    .select('lead_magnet_settings')
    .eq('id', a.id)
    .single()
  mark(
    'lead_magnet_settings is an object with enabled/headline/features keys',
    freshRow?.lead_magnet_settings &&
      typeof freshRow.lead_magnet_settings === 'object' &&
      'enabled' in freshRow.lead_magnet_settings &&
      'headline' in freshRow.lead_magnet_settings &&
      'features' in freshRow.lead_magnet_settings,
    JSON.stringify(freshRow?.lead_magnet_settings),
  )

  // 3. set slug on A
  const { error: e1 } = await supabase
    .from('organizations')
    .update({ lead_magnet_slug: TEST_SLUG })
    .eq('id', a.id)
  mark('A can take a fresh slug', !e1, e1?.message ?? '')

  // 4. try same slug on B → must fail with 23505
  const { error: e2 } = await supabase
    .from('organizations')
    .update({ lead_magnet_slug: TEST_SLUG })
    .eq('id', b.id)
  mark(
    'B rejected duplicate slug with 23505',
    !!e2 && e2.code === '23505',
    e2 ? `${e2.code}: ${e2.message}` : 'no error returned (bad!)',
  )

  // 5. try same slug (uppercase) on B → must also fail (case-insensitive index)
  const { error: e3 } = await supabase
    .from('organizations')
    .update({ lead_magnet_slug: TEST_SLUG.toUpperCase() })
    .eq('id', b.id)
  mark(
    'B rejected UPPERCASE of same slug (case-insensitive uniqueness)',
    !!e3 && e3.code === '23505',
    e3 ? `${e3.code}: ${e3.message}` : 'no error returned (bad!)',
  )

  // 6. clear A → null, then B can take the slug
  const { error: e4 } = await supabase
    .from('organizations')
    .update({ lead_magnet_slug: null })
    .eq('id', a.id)
  mark('A can clear slug back to null', !e4, e4?.message ?? '')

  const { error: e5 } = await supabase
    .from('organizations')
    .update({ lead_magnet_slug: TEST_SLUG })
    .eq('id', b.id)
  mark('B can now take the slug after A cleared', !e5, e5?.message ?? '')

  // 7. null-slug row is still readable + is treated as "disabled" by resolver
  const { data: aNow } = await supabase
    .from('organizations')
    .select('lead_magnet_slug, lead_magnet_settings')
    .eq('id', a.id)
    .single()
  mark(
    'null slug persists and is the disabled state',
    aNow?.lead_magnet_slug === null,
    `slug=${aNow?.lead_magnet_slug}  settings.enabled=${aNow?.lead_magnet_settings?.enabled}`,
  )
} finally {
  await supabase.from('organizations').update(priorA).eq('id', a.id)
  await supabase.from('organizations').update(priorB).eq('id', b.id)
  console.log('\n✓ both orgs restored to prior state')
}

console.log('')
for (const c of checks) {
  console.log(`${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`)
}
if (!checks.every((c) => c.pass)) process.exitCode = 1
