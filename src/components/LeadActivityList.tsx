'use client'

import { useState } from 'react'

export type Activity = {
  id:         string
  content:    string
  created_at: string
  author:     string | null
}

interface Props {
  activities: Activity[]
}

const INITIAL_LIMIT = 5

function fmtRelative(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function LeadActivityList({ activities }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (activities.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-gray-500 text-sm">
        No activity yet. Add the first note above.
      </div>
    )
  }

  const visible = expanded ? activities : activities.slice(0, INITIAL_LIMIT)
  const hasMore = activities.length > INITIAL_LIMIT

  return (
    <>
      <ul className="divide-y divide-pvx-border">
        {visible.map(a => (
          <li key={a.id} className="px-5 py-4">
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-pvx-border/50">
              <span className="text-xs text-gray-500">{a.author ?? 'Unknown user'}</span>
              <span className="text-xs text-gray-500">· {fmtRelative(a.created_at)}</span>
            </div>
            <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap break-words">{a.content}</p>
          </li>
        ))}
      </ul>

      {hasMore && (
        <div className="px-5 py-3 border-t border-pvx-border">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="w-full rounded-lg border border-pvx-border bg-transparent px-3 py-2 text-xs font-medium text-gray-400 hover:text-white hover:border-violet-500/40 transition-colors"
          >
            {expanded
              ? 'Show fewer notes'
              : `See all notes (${activities.length})`}
          </button>
        </div>
      )}
    </>
  )
}
