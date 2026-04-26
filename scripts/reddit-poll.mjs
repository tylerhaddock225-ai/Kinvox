// Reddit → /api/v1/signals/ingest poller.
//
// Hits Reddit's global search.json with an OK-targeted query, filters the
// returned posts by keyword (defense-in-depth against loose Reddit
// matches), and POSTs each hit to the local ingest route. Cross-run dedup
// is handled server-side via the partial unique index on
// pending_signals(organization_id, external_post_id).
//
// Usage:
//   node --env-file=.env.local scripts/reddit-poll.mjs                # one shot
//   node --env-file=.env.local scripts/reddit-poll.mjs --watch        # loop, 60s
//
// Env:
//   INGEST_API_KEY        required — sent as x-kinvox-ingest-key
//   NEXT_PUBLIC_APP_URL   optional — base URL of the local app (default http://localhost:3000)

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

// Default query: storm-shelter / safe-room intent narrowed to OK metro
// signals. Reddit's search supports OR-grouping in parens like this.
const DEFAULT_QUERY =
  '("storm shelter" OR "safe room") (Oklahoma OR OKC OR Moore OR Tulsa OR Norman OR Edmond OR 73160 OR 405)'

const QUERY      = typeof args.query    === 'string' ? args.query    : DEFAULT_QUERY
const VERTICAL   = typeof args.vertical === 'string' ? args.vertical : 'storm_shelter'
const KEYWORDS   = (typeof args.keywords === 'string' ? args.keywords : 'storm shelter,safe room')
  .split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
const WATCH      = Boolean(args.watch)
const POLL_MS    = 60_000  // Reddit asks for ≤1 req/sec; we poll the listing once per minute.
const LIMIT      = Math.min(Number(args.limit) || 100, 100)
const USER_AGENT = 'kinvox-sandbox-poller/0.1 (by /u/kinvox-dev)'

const ingestKey = process.env.INGEST_API_KEY?.trim()
if (!ingestKey) {
  console.error('missing INGEST_API_KEY in env')
  process.exit(1)
}
const appBase = (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '')
const ingestUrl = `${appBase}/api/v1/signals/ingest`
const feedUrl   =
  `https://www.reddit.com/search.json` +
  `?q=${encodeURIComponent(QUERY)}` +
  `&sort=new&limit=${LIMIT}&type=link&include_over_18=on`

console.log(`poller: query=${QUERY}`)
console.log(`poller: vertical=${VERTICAL} keywords=${JSON.stringify(KEYWORDS)} limit=${LIMIT}`)
console.log(`poller: feed=${feedUrl}`)
console.log(`poller: ingest=${ingestUrl}`)
console.log(`poller: mode=${WATCH ? `watch (every ${POLL_MS / 1000}s)` : 'one-shot'}`)
console.log('')

// Cache of permalinks already submitted *this process*. Server-side index is
// the source of truth for cross-run dedup; this just avoids re-POSTing a
// match we already saw on the previous tick of a long-running --watch loop.
const seen = new Set()

function matchesKeyword(text) {
  const lower = (text || '').toLowerCase()
  return KEYWORDS.find((k) => lower.includes(k)) ?? null
}

async function fetchFeed() {
  const res = await fetch(feedUrl, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`reddit ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  const children = Array.isArray(data?.data?.children) ? data.data.children : []
  return children.map((c) => c?.data).filter(Boolean)
}

async function postSignal({ title, body, author, url }) {
  const res = await fetch(ingestUrl, {
    method:  'POST',
    headers: {
      'content-type':       'application/json',
      'x-kinvox-ingest-key': ingestKey,
    },
    body: JSON.stringify({ title, body, author, url, vertical: VERTICAL }),
  })
  let payload = null
  try { payload = await res.json() } catch { /* non-JSON 5xx */ }
  return { status: res.status, payload }
}

async function tick() {
  const ts = new Date().toISOString()
  let posts
  try {
    posts = await fetchFeed()
  } catch (err) {
    console.error(`[${ts}] feed fetch failed:`, err.message)
    return
  }

  let scanned = 0, matched = 0, sent = 0
  for (const post of posts) {
    scanned++
    const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : null
    if (!permalink) continue
    if (seen.has(permalink)) continue

    const title    = typeof post.title    === 'string' ? post.title    : ''
    const selftext = typeof post.selftext === 'string' ? post.selftext : ''
    const author   = typeof post.author   === 'string' ? post.author   : ''

    const hit = matchesKeyword(`${title}\n${selftext}`)
    if (!hit) continue
    matched++
    seen.add(permalink)

    const { status, payload } = await postSignal({
      title,
      body:   selftext,
      author,
      url:    permalink,
    })
    sent++
    const summary = payload?.deduplicated
      ? `dedup (${payload.already_ingested} existing)`
      : payload?.gated
        ? `gated: ${payload.reason}${payload.intent_score != null ? ` (intent=${payload.intent_score})` : ''}`
        : payload?.matched != null
          ? `inserted=${payload.inserted} matched=${payload.matched}/${payload.candidates}`
          : payload?.error ?? 'no-summary'
    console.log(`[${ts}] hit="${hit}" "${title.slice(0, 70)}" → ${status} ${summary}`)
  }

  console.log(`[${ts}] tick complete — scanned=${scanned} matched=${matched} sent=${sent}`)
}

await tick()
if (WATCH) {
  // setInterval keeps the event loop alive; signals end the process.
  setInterval(tick, POLL_MS)
  process.on('SIGINT',  () => { console.log('\nshutdown'); process.exit(0) })
  process.on('SIGTERM', () => { console.log('\nshutdown'); process.exit(0) })
}
