// One-off: delete sandbox pending_signals rows that fail the new vertical
// or intent gates. Reports counts before/after so we can see exactly what
// went out, and lists what's left so we can decide on follow-up sweeps.
//
// Usage: node --env-file=.env.local scripts/cleanup-pending-signals.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('missing env'); process.exit(1) }
if (!url.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`refusing to run against ${url}`); process.exit(1)
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { count: before } = await admin
  .from('pending_signals')
  .select('*', { count: 'exact', head: true })
console.log(`pending_signals total before: ${before}`)

const { data: lowIntentRows, error: liErr } = await admin
  .from('pending_signals')
  .delete()
  .lt('intent_score', 6)
  .select('id')
if (liErr) { console.error('low-intent delete failed:', liErr.message); process.exit(1) }
console.log(`deleted intent_score<6: ${lowIntentRows?.length ?? 0}`)

const { data: offVertRows, error: ovErr } = await admin
  .from('pending_signals')
  .delete()
  .ilike('reasoning_snippet', '%off-vertical%')
  .select('id')
if (ovErr) { console.error('off-vertical delete failed:', ovErr.message); process.exit(1) }
console.log(`deleted reasoning_snippet ~ "off-vertical": ${offVertRows?.length ?? 0}`)

const { count: after } = await admin
  .from('pending_signals')
  .select('*', { count: 'exact', head: true })
console.log(`pending_signals total after:  ${after}`)

console.log('')
console.log('remaining rows (sample of up to 20):')
const { data: remaining } = await admin
  .from('pending_signals')
  .select('id, intent_score, reasoning_snippet, external_post_id, created_at')
  .order('created_at', { ascending: false })
  .limit(20)
for (const r of remaining ?? []) {
  console.log(`  intent=${r.intent_score}  ${r.external_post_id?.slice(0, 60)}  — ${r.reasoning_snippet?.slice(0, 60)}`)
}
