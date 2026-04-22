// One-off Sandbox verification:
// 1. Pull the seeded Storm Shelter template
// 2. Borrow the first live Sandbox org (saving + restoring its prior
//    ai_template_id / enabled_ai_features so we leave no footprint)
// 3. Set toggles with virtual_fitment OFF, soh_grant_screener ON,
//    tribal_grant_check ON
// 4. Re-implement applyFeatureGating exactly as src/lib/ai-runtime.ts
//    does and run it against the seeded prompt
// 5. Assert the disabled block is gone and enabled blocks survive

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load .env.local manually so we don't pull a dotenv dep just for this.
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
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

const url     = env.NEXT_PUBLIC_SUPABASE_URL
const service = env.SUPABASE_SERVICE_ROLE_KEY

if (!url.includes('ntwimeqxyyvjyrisqofl')) {
  console.error('ABORT: .env.local is not pointing at Sandbox. URL =', url)
  process.exit(1)
}

const supabase = createClient(url, service, { auth: { persistSession: false } })

// ---- Mirror of applyFeatureGating from src/lib/ai-runtime.ts ----
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function blockRe(key) {
  return new RegExp(
    String.raw`(?:\r?\n)?\[\[FEATURE:${escapeRe(key)}\]\][\s\S]*?\[\[\/FEATURE:${escapeRe(key)}\]\](?:\r?\n)?`,
    'g',
  )
}
function applyFeatureGating(basePrompt, features, enabled) {
  let out = basePrompt
  for (const f of features) {
    if (!enabled[f.key]) out = out.replace(blockRe(f.key), '\n')
  }
  out = out.replace(/^\s*\[\[\/?FEATURE:[^\]]+\]\]\s*$/gm, '')
  return out.replace(/\n{3,}/g, '\n\n').trim()
}
function resolveEnabledFeatures(features, enabled) {
  const out = {}
  for (const f of features) {
    out[f.key] = enabled && f.key in enabled ? !!enabled[f.key] : f.default_enabled
  }
  return out
}

// ---- 1. Fetch template ----
const { data: template, error: tErr } = await supabase
  .from('ai_templates')
  .select('id, name, base_prompt, metadata')
  .eq('name', 'Storm Shelter')
  .single()
if (tErr || !template) throw new Error('Storm Shelter template missing: ' + (tErr?.message ?? 'not found'))
const features = template.metadata?.features ?? []
console.log(`✓ template: ${template.name} (${template.id})  features=${features.map(f=>f.key).join(',')}`)

// ---- 2. Borrow an org ----
const { data: orgs, error: oErr } = await supabase
  .from('organizations')
  .select('id, name, ai_template_id, enabled_ai_features')
  .is('deleted_at', null)
  .order('created_at', { ascending: true })
  .limit(1)
if (oErr || !orgs?.length) throw new Error('No live sandbox orgs')
const target = orgs[0]
console.log(`✓ borrowing org: ${target.name} (${target.id})`)
const prior = { ai_template_id: target.ai_template_id, enabled_ai_features: target.enabled_ai_features }

try {
  // ---- 3. Write test toggles ----
  const testEnabled = { soh_grant_screener: true, virtual_fitment: false, tribal_grant_check: true }
  const { error: pErr } = await supabase
    .from('organizations')
    .update({ ai_template_id: template.id, enabled_ai_features: testEnabled })
    .eq('id', target.id)
  if (pErr) throw pErr

  // ---- 4. Re-fetch + resolve like /api/merchant/ai-features would ----
  const { data: refreshed } = await supabase
    .from('organizations')
    .select('ai_template_id, enabled_ai_features')
    .eq('id', target.id)
    .single()
  console.log(`✓ org now has ai_template_id=${refreshed.ai_template_id}`)
  console.log(`  enabled_ai_features =`, refreshed.enabled_ai_features)

  const enabled = resolveEnabledFeatures(features, refreshed.enabled_ai_features)
  const resolved = applyFeatureGating(template.base_prompt, features, enabled)

  // ---- 5. Assertions ----
  const checks = [
    { name: 'virtual_fitment block stripped',
      pass: !resolved.includes('Virtual Fitment') && !resolved.includes('[[FEATURE:virtual_fitment]]') },
    { name: 'soh_grant_screener block kept',
      pass: resolved.includes('SOH Grant Screener') && !resolved.includes('[[FEATURE:soh_grant_screener]]') },
    { name: 'tribal_grant_check block kept',
      pass: resolved.includes('Tribal Grant Check') && !resolved.includes('[[FEATURE:tribal_grant_check]]') },
    { name: 'no surviving FEATURE tags',
      pass: !/\[\[\/?FEATURE:/.test(resolved) },
    { name: 'April 2026 / SOH Wave 2 wording present',
      pass: resolved.includes('April 2026') && resolved.includes('SOH Grant Wave 2') },
  ]
  console.log('')
  for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.name}`)

  console.log('\n— resolved prompt preview (first 600 chars) —')
  console.log(resolved.slice(0, 600))
  console.log('— end preview —')

  if (!checks.every((c) => c.pass)) process.exitCode = 1
} finally {
  // ---- restore ----
  await supabase
    .from('organizations')
    .update(prior)
    .eq('id', target.id)
  console.log(`\n✓ restored ${target.name} to prior strategy`)
}
