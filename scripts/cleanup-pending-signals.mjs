// One-off: delete sandbox pending_signals rows that fail the new vertical
// or intent gates. Reports counts before/after so we can see exactly what
// went out, and lists what's left so we can decide on follow-up sweeps.
//
// Usage:
//   node --env-file=.env.local scripts/cleanup-pending-signals.mjs            # literal gate-criterion sweep only
//   node --env-file=.env.local scripts/cleanup-pending-signals.mjs --nuke     # also delete known off-vertical subreddits

import { createClient } from '@supabase/supabase-js'

const NUKE = process.argv.includes('--nuke')

// Subreddits whose posts are reliably off-vertical for the storm_shelter
// vertical — disability/medical/financial/escort communities that scored 6
// before the vertical relevance gate was deployed.
const NUKE_SUBS = [
  'disability', 'AskDocs', 'Methadone_AskNAnswer',
  'SocialSecurity', 'SSDI', 'stroke',
  'DisabilityHacks', 'ClientsAndCompanions',
]

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

if (NUKE) {
  for (const sub of NUKE_SUBS) {
    const { data, error } = await admin
      .from('pending_signals')
      .delete()
      .ilike('external_post_id', `%/r/${sub}/%`)
      .select('id')
    if (error) { console.error(`nuke r/${sub} failed:`, error.message); continue }
    console.log(`nuked r/${sub}: ${data?.length ?? 0}`)
  }
}

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
