// Signal intent scorer — wraps the Anthropic Messages API.
//
// Pricing tiers map directly to credit deduction:
//   1  → low-intent browse ("thinking about a roofer")
//   3  → medium-intent need ("need a quote this week")
//   6  → urgent / emergency ("tornado damage, leaking NOW")
//
// Privacy Guard (Commandment 2): the prompt explicitly forbids PII in the
// reasoning_snippet, AND we scrub the returned text post-hoc using the
// author fields we already know. This is defense-in-depth — a
// jailbroken or sloppy model response still cannot leak names/handles
// into our leads.metadata audit trail.

export type IntentTier = 1 | 3 | 6

export type IntentScore = {
  intent_score:       IntentTier
  reasoning_snippet:  string
  /** True when we fell back to a heuristic score (no AI call). */
  scoring_skipped:    boolean
  /** True when the scrubber had to rewrite the snippet. */
  pii_redacted:       boolean
}

type ScoreInput = {
  platform:       string
  raw_text:       string
  location:       string
  author_name?:   string
  author_handle?: string
}

// Claude Haiku is the cheap/fast tier — right shape for a per-signal
// classifier. Override with ANTHROPIC_SCORING_MODEL for experiments.
const DEFAULT_MODEL = 'claude-haiku-4-5'

const SYSTEM_PROMPT = [
  'Analyze the following social post for intent.',
  'Return a JSON object with:',
  '  1) intent_score (exactly 1, 3, or 6) — 1=low/browse, 3=medium/need, 6=urgent/emergency',
  '  2) reasoning_snippet (Max 15 words)',
  '',
  'IMPORTANT: Your reasoning_snippet MUST NOT include the user\'s name, handle, or contact info.',
  'Focus only on the urgency and keywords like "leaking", "tornado", "immediate".',
  '',
  'Output ONLY the JSON object, no prose, no code fences.',
].join('\n')

function clampTier(n: unknown): IntentTier {
  if (n === 6 || n === '6') return 6
  if (n === 3 || n === '3') return 3
  return 1
}

// Post-LLM PII scrubber. Fires on three classes of leak:
//   1. The literal author_name / author_handle we passed in (exact substring).
//   2. Anything starting with '@' (handle).
//   3. Phone-looking patterns and emails.
// Returns { text, redacted } so the caller can flag the record.
// `wordCap` of 0 disables the word-count truncation (useful for draft
// replies where we cap on characters instead).
export function scrubPii(
  text: string,
  opts: { author_name?: string; author_handle?: string; wordCap?: number } = {},
): { text: string; redacted: boolean } {
  let out = text
  let redacted = false
  const { author_name, author_handle, wordCap = 15 } = opts

  for (const needle of [author_name, author_handle].filter(Boolean) as string[]) {
    if (needle.length < 2) continue
    const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    if (rx.test(out)) {
      out = out.replace(rx, '[redacted]')
      redacted = true
    }
  }

  const handleRx = /@[\w.]+/g
  if (handleRx.test(out)) { out = out.replace(handleRx, '[handle]');      redacted = true }

  const emailRx  = /[\w.+-]+@[\w-]+\.[\w.-]+/g
  if (emailRx.test(out))  { out = out.replace(emailRx, '[email]');        redacted = true }

  const phoneRx  = /(?:\+?\d[\d\s().-]{7,}\d)/g
  if (phoneRx.test(out))  { out = out.replace(phoneRx, '[phone]');        redacted = true }

  if (wordCap > 0) {
    const words = out.trim().split(/\s+/)
    if (words.length > wordCap) {
      out = words.slice(0, wordCap).join(' ') + '…'
      redacted = true
    }
  }

  return { text: out, redacted }
}

function heuristicFallback(reason: string): IntentScore {
  return {
    intent_score:      1,
    reasoning_snippet: reason,
    scoring_skipped:   true,
    pii_redacted:      false,
  }
}

export async function scoreSignalIntent(input: ScoreInput): Promise<IntentScore> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Sandbox-friendly: never block lead capture just because the AI key
    // is unset. We log + record the skip in metadata.
    console.warn('[intent-scorer] ANTHROPIC_API_KEY unset — using fallback tier=1')
    return heuristicFallback('AI scoring unavailable')
  }

  const model = process.env.ANTHROPIC_SCORING_MODEL || DEFAULT_MODEL

  // The user message holds the payload; the system prompt carries the
  // rules. We deliberately do NOT pass author_name / author_handle into
  // the model — the model cannot leak what it was never shown. location
  // and raw_text are the only fields it gets.
  const userMessage = JSON.stringify({
    platform: input.platform,
    location: input.location,
    post:     input.raw_text,
  })

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[intent-scorer] fetch failed:', msg)
    return heuristicFallback('AI scoring offline')
  }

  if (!res.ok) {
    console.error('[intent-scorer] Anthropic returned', res.status, await res.text().catch(() => ''))
    return heuristicFallback('AI scoring rejected')
  }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return heuristicFallback('AI scoring parse failed')
  }

  const text = extractText(payload)
  if (!text) return heuristicFallback('AI scoring empty')

  let parsed: { intent_score?: unknown; reasoning_snippet?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    // Sometimes models wrap with prose; grab the first {...} block.
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return heuristicFallback('AI scoring non-JSON')
    try { parsed = JSON.parse(match[0]) }
    catch { return heuristicFallback('AI scoring non-JSON') }
  }

  const tier    = clampTier(parsed.intent_score)
  const rawSnip = typeof parsed.reasoning_snippet === 'string'
    ? parsed.reasoning_snippet.trim()
    : ''
  const scrubbed = scrubPii(rawSnip || 'no reasoning returned', {
    author_name:   input.author_name,
    author_handle: input.author_handle,
  })

  return {
    intent_score:      tier,
    reasoning_snippet: scrubbed.text,
    scoring_skipped:   false,
    pii_redacted:      scrubbed.redacted,
  }
}

type MessagesApiResponse = {
  content?: Array<{ type?: string; text?: string }>
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const content = (payload as MessagesApiResponse).content
  if (!Array.isArray(content)) return null
  const block = content.find((c) => c?.type === 'text' && typeof c.text === 'string')
  return block?.text?.trim() || null
}


// ─── Draft reply generator ────────────────────────────────────────────────

export type DraftReply = {
  text:           string
  /** True when the model was unreachable and we returned a template. */
  draft_skipped:  boolean
  /** True when the scrubber rewrote anything in the returned text. */
  pii_redacted:   boolean
  /** True when we had to append the required landing-page link. */
  link_appended:  boolean
}

type DraftInput = {
  organization_name: string
  landing_slug:      string          // org.lead_magnet_slug
  signal_id?:        string          // when present, embedded as ?sig= for attribution
  raw_text:          string
  platform:          string
  author_name?:      string
  author_handle?:    string
}

const DRAFT_CHAR_CAP = 250

// Canonical base URL — keeps templates and prompts aligned. If you change
// the public lead-magnet host, this is the single place to swap.
const DRAFT_LINK_BASE = 'https://kinvoxtech.com/l'

// Builds the lead-magnet URL the AI reply will embed. When a signal id is
// supplied we tack on `?sig=<uuid>` so the lead-capture action can write
// the originating signal id into leads.metadata, giving HQ + the merchant
// a clean attribution trail from social post → unlock → form submission.
function buildDraftLink(slug: string, signalId?: string): string {
  const base = `${DRAFT_LINK_BASE}/${encodeURIComponent(slug)}`
  return signalId ? `${base}?sig=${encodeURIComponent(signalId)}` : base
}

function ensureLink(text: string, link: string): { text: string; appended: boolean } {
  if (text.includes(link)) return { text, appended: false }
  // Append the link on its own line if we have the budget; otherwise replace
  // the tail of the reply. The char cap is enforced after this runs.
  const separator = text.endsWith('.') || text.endsWith('!') || text.endsWith('?') ? ' ' : ' — '
  return { text: `${text}${separator}${link}`, appended: true }
}

function capLength(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

function templateFallback(orgName: string, slug: string, signalId?: string): DraftReply {
  const link = buildDraftLink(slug, signalId)
  const body = `Hi! ${orgName} can help with this — see details here: ${link}`
  return {
    text:          capLength(body, DRAFT_CHAR_CAP),
    draft_skipped: true,
    pii_redacted:  false,
    link_appended: true,
  }
}

/**
 * Two-step AI, step 2: produces a short, context-aware reply the tenant
 * can approve-and-send via the pending_signals queue.
 *
 * Privacy: the raw post is passed to the model so it can reference a
 * specific detail, but author_name / author_handle are NOT passed — the
 * model cannot write what it was never shown. The post-generation
 * scrubber is belt-and-suspenders for anything that slips through.
 *
 * Contract enforced outside the prompt:
 *   1. `DRAFT_LINK_BASE/<slug>` is present (appended if the model forgot).
 *   2. Reply is ≤ 250 chars.
 *   3. PII is scrubbed.
 */
export async function generateDraftReply(input: DraftInput): Promise<DraftReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[draft-reply] ANTHROPIC_API_KEY unset — using template fallback')
    return templateFallback(input.organization_name, input.landing_slug, input.signal_id)
  }

  const model = process.env.ANTHROPIC_DRAFTING_MODEL
    || process.env.ANTHROPIC_SCORING_MODEL
    || DEFAULT_MODEL

  const link = buildDraftLink(input.landing_slug, input.signal_id)

  const systemPrompt = [
    `You are a helpful assistant for ${input.organization_name}.`,
    `Write a short, friendly social media reply (max ${DRAFT_CHAR_CAP} chars) to this post.`,
    'Mention a specific detail from their post.',
    'DO NOT include PII (names, handles, phone numbers, emails).',
    `Always include the link: ${link}`,
    '',
    'Output ONLY the reply text — no preamble, no quotes, no code fences.',
  ].join('\n')

  const userMessage = JSON.stringify({
    platform: input.platform,
    post:     input.raw_text,
  })

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[draft-reply] fetch failed:', msg)
    return templateFallback(input.organization_name, input.landing_slug, input.signal_id)
  }

  if (!res.ok) {
    console.error('[draft-reply] Anthropic returned', res.status, await res.text().catch(() => ''))
    return templateFallback(input.organization_name, input.landing_slug, input.signal_id)
  }

  const rawText = extractText(await res.json().catch(() => null))
  if (!rawText) return templateFallback(input.organization_name, input.landing_slug, input.signal_id)

  // Strip surrounding quotes if the model added any despite the instruction.
  const stripped = rawText.replace(/^["'`]+|["'`]+$/g, '').trim()

  // Scrub first (wordCap=0 — we cap on chars below), then ensure link,
  // then hard-cap length. Order matters: appending the link after the
  // char cap could blow the budget.
  const scrubbed = scrubPii(stripped, {
    author_name:   input.author_name,
    author_handle: input.author_handle,
    wordCap:       0,
  })

  const withLink = ensureLink(scrubbed.text, link)
  const finalText = capLength(withLink.text, DRAFT_CHAR_CAP)

  return {
    text:          finalText,
    draft_skipped: false,
    pii_redacted:  scrubbed.redacted,
    link_appended: withLink.appended,
  }
}


// ─── Triage: intent + geo extraction in one call ─────────────────────────
//
// Used by /api/v1/signals/ingest. Supersets scoreSignalIntent() so we hit
// the Anthropic API exactly once per ingest, even though we need both the
// intent tier (for the >=6 fan-out gate) AND the lat/lng/location_name
// (for the geofence fan-out).
//
// scoreSignalIntent() is intentionally left alone — capture route still
// uses it and shouldn't pay the prompt-size tax for fields it doesn't need.

export type TriageResult = {
  intent_score:      IntentTier
  reasoning_snippet: string
  summary:           string | null
  location_name:     string | null
  latitude:          number | null
  longitude:         number | null
  /** True when we fell back to a heuristic / parse-failed path. */
  scoring_skipped:   boolean
  /** True when scrubber rewrote the snippet/summary. */
  pii_redacted:      boolean
}

type TriageInput = {
  platform:       string
  title?:         string
  body?:          string
  author_name?:   string
  author_handle?: string
}

const TRIAGE_SYSTEM_PROMPT = [
  'Analyze this social post and return a single JSON object with these fields:',
  '  intent_score      — exactly 1, 3, or 6 (1=browse, 3=need, 6=urgent/emergency)',
  '  reasoning_snippet — max 15 words, factual, NO names/handles/contacts',
  '  summary           — max 30 words, neutral one-liner describing the situation',
  '  location_name     — the most specific place mentioned (city, neighborhood, region) or null',
  '  latitude          — best-guess decimal degrees for that place, or null if unknown',
  '  longitude         — best-guess decimal degrees for that place, or null if unknown',
  '',
  'Rules:',
  '  - Coordinates must be plausible for the named location. If unsure, return null.',
  '  - Do NOT include PII (names, handles, phone, email) in any text field.',
  '  - Output ONLY the JSON object — no prose, no code fences.',
].join('\n')

function triageFallback(reason: string): TriageResult {
  return {
    intent_score:      1,
    reasoning_snippet: reason,
    summary:           null,
    location_name:     null,
    latitude:          null,
    longitude:         null,
    scoring_skipped:   true,
    pii_redacted:      false,
  }
}

function coerceNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function coerceStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 || t.toLowerCase() === 'null' ? null : t
}

export async function triageSignal(input: TriageInput): Promise<TriageResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[triage] ANTHROPIC_API_KEY unset — using fallback')
    return triageFallback('AI triage unavailable')
  }

  const model = process.env.ANTHROPIC_SCORING_MODEL || DEFAULT_MODEL

  // Same posture as scoreSignalIntent: never pass author identifiers into
  // the model. Title + body + platform is the entire context surface.
  const userMessage = JSON.stringify({
    platform: input.platform,
    title:    input.title || '',
    body:     input.body  || '',
  })

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        system:     TRIAGE_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[triage] fetch failed:', msg)
    return triageFallback('AI triage offline')
  }

  if (!res.ok) {
    console.error('[triage] Anthropic returned', res.status, await res.text().catch(() => ''))
    return triageFallback('AI triage rejected')
  }

  const text = extractText(await res.json().catch(() => null))
  if (!text) return triageFallback('AI triage empty')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return triageFallback('AI triage non-JSON')
    try { parsed = JSON.parse(match[0]) as Record<string, unknown> }
    catch { return triageFallback('AI triage non-JSON') }
  }

  const tier        = clampTier(parsed.intent_score)
  const rawSnippet  = coerceStr(parsed.reasoning_snippet) || 'no reasoning returned'
  const rawSummary  = coerceStr(parsed.summary)
  const locName     = coerceStr(parsed.location_name)
  const lat         = coerceNum(parsed.latitude)
  const lng         = coerceNum(parsed.longitude)

  // Reject obviously-bogus coords. Out-of-range pairs would silently break
  // the haversine fan-out by routing nowhere or everywhere.
  const validLat = lat !== null && lat >= -90  && lat <= 90  ? lat : null
  const validLng = lng !== null && lng >= -180 && lng <= 180 ? lng : null

  const scrubAuthor = {
    author_name:   input.author_name,
    author_handle: input.author_handle,
  }
  const scrubbedSnippet = scrubPii(rawSnippet, { ...scrubAuthor, wordCap: 15 })
  const scrubbedSummary = rawSummary
    ? scrubPii(rawSummary, { ...scrubAuthor, wordCap: 30 })
    : { text: '', redacted: false }

  return {
    intent_score:      tier,
    reasoning_snippet: scrubbedSnippet.text,
    summary:           rawSummary ? scrubbedSummary.text : null,
    location_name:     locName,
    latitude:          validLat !== null && validLng !== null ? validLat : null,
    longitude:         validLat !== null && validLng !== null ? validLng : null,
    scoring_skipped:   false,
    pii_redacted:      scrubbedSnippet.redacted || scrubbedSummary.redacted,
  }
}
