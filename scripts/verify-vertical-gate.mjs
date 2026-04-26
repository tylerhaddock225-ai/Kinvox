// Verify the vertical-relevance gate end-to-end through /api/v1/signals/ingest.
// Three probes:
//   1. Off-vertical methadone post that mentions "storm shelter" in passing
//   2. On-vertical urgent shelter request in Norman, OK
//   3. Off-vertical metaphorical "safe room" (emotional space)
//
// Expect: #1 and #3 → gated low_intent (intent_score=1).
//         #2       → inserted (intent_score=6, matched=1).
// We delete the inserted probe row at the end so the dashboard stays clean.
//
// Usage: node --env-file=.env.local scripts/verify-vertical-gate.mjs

import { createClient } from '@supabase/supabase-js'

const ingestKey = process.env.INGEST_API_KEY?.trim()
const supaUrl   = process.env.NEXT_PUBLIC_SUPABASE_URL
const supaKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!ingestKey || !supaUrl || !supaKey) { console.error('missing env'); process.exit(1) }

const appBase = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')
const ingestUrl = `${appBase}/api/v1/signals/ingest`

const stamp = Date.now()
const cases = [
  {
    label:  'off-vertical: methadone advice',
    expect: { gated: true, intent_score: 1 },
    payload: {
      vertical: 'storm_shelter',
      url:      `https://verify.local/methadone/${stamp}`,
      author:   'verify_probe',
      title:    'Question, would my primary care doctor know if I entered a methadone program',
      body:     "I'm in Norman OK and considering methadone treatment. My PCP is great but I'm worried about it showing up. Side note — we hid in the storm shelter last week during the warning.",
    },
  },
  {
    label:  'on-vertical: urgent Norman shelter',
    expect: { inserted: true, intent_score: 6 },
    payload: {
      vertical: 'storm_shelter',
      url:      `https://verify.local/norman-shelter/${stamp}`,
      author:   'verify_probe',
      title:    'Public Storm shelter (new to norman help plz)',
      body:     "Just moved to Norman OK. Tornado warning is active right now and I have no idea where the nearest public shelter is. Apartment has no basement. Please help.",
    },
  },
  {
    label:  'off-vertical: emotional safe room',
    expect: { gated: true, intent_score: 1 },
    payload: {
      vertical: 'storm_shelter',
      url:      `https://verify.local/emotional-safe-room/${stamp}`,
      author:   'verify_probe',
      title:    'Building a safe room in my head to survive my anxiety',
      body:     "Therapist suggested I imagine a safe room — a place where nothing can hurt me. Anyone else use this technique? It's helped during panic attacks.",
    },
  },
]

async function postProbe(body) {
  const res = await fetch(ingestUrl, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-kinvox-ingest-key': ingestKey },
    body:    JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

let pass = 0, fail = 0
for (const c of cases) {
  const { status, body } = await postProbe(c.payload)
  let ok = false
  if (c.expect.gated) {
    ok = status === 200 && body?.gated === true && body?.intent_score === c.expect.intent_score
  } else if (c.expect.inserted) {
    ok = status === 200 && body?.inserted >= 1 && body?.intent_score === c.expect.intent_score
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${c.label}`)
  console.log(`       status=${status} intent=${body?.intent_score} gated=${body?.gated ?? false} inserted=${body?.inserted ?? 0} reason=${body?.reason ?? '-'}`)
  if (ok) pass++; else fail++
}

// Cleanup the on-vertical insert so the dashboard isn't polluted.
const admin = createClient(supaUrl, supaKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: delErr } = await admin
  .from('pending_signals')
  .delete()
  .like('external_post_id', 'https://verify.local/%')
if (delErr) console.error('cleanup warning:', delErr.message)
else        console.log('cleanup: removed verify.local probe rows')

console.log(`\nresults: ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
