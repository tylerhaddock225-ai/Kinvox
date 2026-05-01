'use client'

// Generic message-thread renderer used by lead detail (Conversation panel).
// Mirrors the visual treatment Tickets uses inline today (yellow tinted
// border for internal/private notes, neutral surface for public messages).
//
// Authored as a shared component so future surfaces (customer threads,
// HQ-support threads, etc.) can use the same renderer without copying
// the layout. Tickets itself still uses its inline rendering today; a
// future PR can backport this component there once the lead surface
// has shaken out.

export type ConversationMessage = {
  id:           string
  variant:      'public' | 'internal'
  authorName:   string
  authorBadge?: string                  // optional pill next to the name (e.g. "Lead", "Private Note")
  body:         string
  createdAt:    string
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '??'
}

export default function ConversationThread({
  messages,
  emptyHint = 'No messages yet. Start the conversation below.',
}: {
  messages:   ConversationMessage[]
  emptyHint?: string
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-pvx-border bg-pvx-surface/30 px-6 py-10 text-center text-sm text-gray-500">
        {emptyHint}
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const isInternal = m.variant === 'internal'
        return (
          <li
            key={m.id}
            className={`rounded-xl border px-4 py-3 ${
              isInternal
                ? 'border-yellow-500/30 bg-yellow-500/10'
                : 'border-pvx-border bg-pvx-surface'
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-violet-600/20 text-violet-300 text-[11px] font-semibold">
                  {initials(m.authorName)}
                </span>
                <span className="text-sm font-medium text-white">{m.authorName}</span>
                {m.authorBadge && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${
                      isInternal
                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                        : 'bg-violet-500/15 text-violet-200 border-violet-500/30'
                    }`}
                  >
                    {m.authorBadge}
                  </span>
                )}
              </div>
              <time className="text-xs text-gray-500">
                {new Date(m.createdAt).toLocaleString()}
              </time>
            </div>
            <div className="text-sm text-gray-200 whitespace-pre-wrap">{m.body}</div>
          </li>
        )
      })}
    </ul>
  )
}
