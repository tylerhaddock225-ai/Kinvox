'use client'

import { useState, useTransition } from 'react'
import {
  Globe,
  MessageSquare,
  Sparkles,
  Send,
  Trash2,
  AlertCircle,
  Flame,
  Zap,
  Leaf,
  ExternalLink,
  Lock,
  Tag,
  MapPin,
} from 'lucide-react'
import { sendSignalReply, dismissSignal } from '@/app/(app)/(dashboard)/actions/signals'
import SignalUnlockButton from './SignalUnlockButton'
import type { PendingSignal } from '@/lib/types/database.types'

type Props = {
  signal:   PendingSignal
  onRemove: (id: string) => void
}

const REPLY_CHAR_LIMIT = 280

// Stopword filter for keyword extraction. Tiny list — the reasoning_snippet
// is capped at 15 words by the scorer, so even a short stoplist works.
const STOPWORDS = new Set([
  'the','a','an','and','or','of','in','on','to','for','at','by','with','from',
  'is','are','was','were','be','been','being','it','this','that','these','those',
  'as','but','if','so','some','any','no','not','do','does','did','has','have',
  'had','will','would','can','could','should','may','might','their','they',
  'them','his','her','our','your','my','its','about','into','than','then',
])

/**
 * Pulls a short list of "loud" words out of the AI-scored reasoning_snippet.
 * The scorer hard-redacts PII server-side, so anything left here is safe
 * to render unredacted. Heuristic only — strips punctuation, drops stop-
 * words, dedupes, caps at 5 keywords. When the snippet is missing or too
 * thin we return an empty array and the UI hides the Keywords row.
 */
function extractKeywords(snippet: string | null): string[] {
  if (!snippet) return []
  const words = snippet
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words) {
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
    if (out.length >= 5) break
  }
  return out
}

function platformIcon(platform: string | null) {
  const key = (platform ?? '').toLowerCase()
  if (key.includes('reddit') || key.includes('forum')
      || key.includes('twitter') || key === 'x'
      || key.includes('facebook') || key.includes('instagram')
      || key.includes('linkedin')) {
    return <MessageSquare className="w-3.5 h-3.5" />
  }
  return <Globe className="w-3.5 h-3.5" />
}

function intentBadge(score: number | null) {
  if (score === 6) {
    return {
      label: 'Urgent',
      icon:  <Flame className="w-3 h-3" />,
      cls:   'border-rose-500/40 bg-rose-500/10 text-rose-200',
    }
  }
  if (score === 3) {
    return {
      label: 'Medium',
      icon:  <Zap className="w-3 h-3" />,
      cls:   'border-amber-500/40 bg-amber-500/10 text-amber-200',
    }
  }
  return {
    label: 'Low',
    icon:  <Leaf className="w-3 h-3" />,
    cls:   'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  }
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const mins = Math.round(diffMs / 60_000)
    if (mins < 1)  return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function SignalCard({ signal, onRemove }: Props) {
  const isLocked = signal.status === 'pending'

  const [draft, setDraft] = useState<string>(signal.ai_draft_reply ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [action, setAction] = useState<'send' | 'dismiss' | null>(null)

  const badge = intentBadge(signal.intent_score)
  const keywords = extractKeywords(signal.reasoning_snippet)
  const tooLong  = draft.length > REPLY_CHAR_LIMIT

  function handleSend() {
    if (!draft.trim())  { setError('Reply cannot be empty'); return }
    if (tooLong)        { setError(`Reply exceeds ${REPLY_CHAR_LIMIT} characters`); return }
    setError(null)
    setAction('send')
    startTransition(async () => {
      const result = await sendSignalReply(signal.id, draft.trim())
      if (result?.status === 'error') {
        setError(result.error)
        setAction(null)
        return
      }
      onRemove(signal.id)
    })
  }

  function handleDismiss() {
    setError(null)
    setAction('dismiss')
    startTransition(async () => {
      const result = await dismissSignal(signal.id)
      if (result?.status === 'error') {
        setError(result.error)
        setAction(null)
        return
      }
      onRemove(signal.id)
    })
  }

  return (
    <article className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-4 shadow-sm">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-pvx-border bg-black/30 px-2 py-1 text-[11px] font-medium text-gray-300">
            {platformIcon(signal.platform)}
            <span className="capitalize">{signal.platform ?? 'unknown'}</span>
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badge.cls}`}>
            {badge.icon}
            {badge.label}
          </span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-200">
              <Lock className="w-3 h-3" />
              Locked
            </span>
          )}
          {/* Every persisted signal already passed the org-level geofence
              gate at capture time (out-of-area submissions are 422'd free
              of charge), so a green "Inside Radius" pill is always
              accurate here — no per-row distance lookup needed. */}
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-200">
            <MapPin className="w-3 h-3" />
            Inside Radius
          </span>
          <span className="text-[11px] text-gray-500">{formatWhen(signal.created_at)}</span>
        </div>
        {signal.external_post_id && signal.external_post_id.startsWith('http') && (
          <a
            href={signal.external_post_id}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-200 transition-colors"
          >
            View post
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </header>

      {/* Keywords (PII-safe — extracted from the scrubbed reasoning_snippet).
          Visible in both locked and unlocked states so the merchant has a
          consistent at-a-glance read on the signal. */}
      {keywords.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Tag className="w-3 h-3 text-gray-500" />
          {keywords.map((kw) => (
            <span
              key={kw}
              className="inline-flex items-center rounded-full border border-pvx-border bg-black/25 px-2 py-0.5 text-[11px] font-medium text-gray-200"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Original post — only visible after unlock. While locked we replace
          this block with the unlock CTA so the merchant has somewhere to
          act from. */}
      {isLocked ? (
        <div className="rounded-lg border border-dashed border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-300" />
            <div>
              <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
                Original post hidden
              </div>
              <p className="mt-0.5 text-xs text-violet-100/80">
                Unlock to read the full post and send the AI-drafted reply.
              </p>
            </div>
          </div>
          <SignalUnlockButton signalId={signal.id} />
        </div>
      ) : (
        <div className="rounded-lg border border-pvx-border bg-black/25 p-4">
          <div className="text-[10px] font-bold tracking-[0.2em] text-gray-500 uppercase mb-1.5">
            Original post
          </div>
          <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">
            {signal.raw_text ?? <span className="text-gray-600 italic">(no text captured)</span>}
          </p>
        </div>
      )}

      {/* AI Insights — reasoning_snippet has been PII-scrubbed at scoring
          time so it's safe to show in both states. Acts as the qualitative
          teaser that justifies the unlock cost. */}
      <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
        <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-300" />
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            AI Insights
          </div>
          {signal.reasoning_snippet ? (
            <p className="mt-0.5 text-xs text-violet-100/80">
              <span className="font-semibold text-violet-100">{badge.label} intent</span>
              <span className="text-violet-300/60"> · </span>
              {signal.reasoning_snippet}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-violet-100/80">
              Scored as <span className="font-semibold text-violet-100">{badge.label.toLowerCase()} intent</span> based on the post content.
            </p>
          )}
        </div>
      </div>

      {/* Draft reply textarea — only available after unlock. The AI draft
          itself is generated at capture time but stored hidden until unlock,
          so the merchant pays once for both the post text and the draft. */}
      {!isLocked && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor={`draft-${signal.id}`} className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
              Draft reply
            </label>
            <span className={`text-[11px] tabular-nums ${tooLong ? 'text-rose-300' : 'text-gray-500'}`}>
              {draft.length} / {REPLY_CHAR_LIMIT}
            </span>
          </div>
          <textarea
            id={`draft-${signal.id}`}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (error) setError(null) }}
            rows={4}
            disabled={isPending}
            className="w-full rounded-lg border border-pvx-border bg-black/30 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40 disabled:opacity-60"
            placeholder="Write your reply…"
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions: dismissal is allowed in both states (merchants shouldn't
          have to pay to throw out spam). Send Reply only after unlock. */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-pvx-border bg-black/25 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-60"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {action === 'dismiss' && isPending ? 'Dismissing…' : 'Dismiss'}
        </button>
        {!isLocked && (
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || !draft.trim() || tooLong}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            {action === 'send' && isPending ? 'Sending…' : 'Send Reply'}
          </button>
        )}
      </div>
    </article>
  )
}
