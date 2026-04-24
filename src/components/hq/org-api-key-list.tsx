'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Key,
  KeyRound,
  Copy,
  Check,
  AlertCircle,
  ShieldAlert,
  X,
  Trash2,
} from 'lucide-react'
import { generateApiKey, revokeApiKey } from '@/app/(app)/(admin)/admin-hq/actions/api-keys'
import ConfirmButton from '@/components/admin/ConfirmButton'

type ApiKeyRow = {
  id:            string
  label:         string | null
  last_used_at:  string | null
  revoked_at:    string | null
  created_at:    string
}

type Props = {
  orgId: string
  keys:  ApiKeyRow[]
  flash?: {
    newKey?:  string | null
    revoked?: boolean
    error?:   string | null
  }
}

export default function OrgApiKeyList({ orgId, keys, flash }: Props) {
  // The raw key only arrives once — via the new_key flash param immediately
  // after mint. We show it in a modal until dismissed, then strip it from
  // the URL so a refresh does not re-show a stale key.
  const [rawKey, setRawKey]   = useState<string | null>(flash?.newKey ?? null)
  const [copied, setCopied]   = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!flash?.newKey) return
    const url = new URL(window.location.href)
    url.searchParams.delete('new_key')
    window.history.replaceState({}, '', url.toString())
  }, [flash?.newKey])

  function closeModal() {
    setRawKey(null)
    setCopied(false)
    router.refresh()
  }

  async function copyKey() {
    if (!rawKey) return
    try {
      await navigator.clipboard.writeText(rawKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard unavailable (older browsers / insecure contexts) — user
      // can still select-and-copy from the input.
    }
  }

  const active  = keys.filter((k) => !k.revoked_at)
  const revoked = keys.filter((k) =>  k.revoked_at)

  return (
    <div className="space-y-5">
      {flash?.revoked ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Key revoked. Future requests using it will return 401.</span>
        </div>
      ) : null}
      {flash?.error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{flash.error}</span>
        </div>
      ) : null}

      {/* Generate */}
      <form
        action={generateApiKey}
        className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-lg border border-pvx-border bg-gray-900 p-4"
      >
        <input type="hidden" name="org_id" value={orgId} />
        <label className="flex-1 block">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
            Label (optional)
          </span>
          <input
            name="label"
            placeholder="e.g. Make.com — social listening"
            className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <KeyRound className="w-4 h-4" />
          Generate Signal API Key
        </button>
      </form>

      {/* Key list */}
      <div className="rounded-lg border border-pvx-border bg-gray-900">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-pvx-border">
          <Key className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-semibold text-white">Keys</h3>
          <span className="text-[11px] text-gray-500">{active.length} active · {revoked.length} revoked</span>
        </header>

        {keys.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-500">
            No keys yet. Generate one above to enable the signal capture endpoint for this org.
          </div>
        ) : (
          <ul className="divide-y divide-pvx-border">
            {[...active, ...revoked].map((k) => {
              const isRevoked = !!k.revoked_at
              return (
                <li key={k.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-100 truncate">
                        {k.label ?? '(unlabeled)'}
                      </span>
                      {isRevoked ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-rose-900/60 bg-rose-950/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-200">
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-200">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-500 font-mono">
                      id {k.id.slice(0, 8)}… · created {formatDate(k.created_at)}
                      {k.last_used_at && <> · last used {formatDate(k.last_used_at)}</>}
                      {k.revoked_at   && <> · revoked {formatDate(k.revoked_at)}</>}
                    </div>
                  </div>
                  {!isRevoked && (
                    <form action={revokeApiKey}>
                      <input type="hidden" name="org_id" value={orgId} />
                      <input type="hidden" name="key_id" value={k.id} />
                      <ConfirmButton
                        message="Revoke this key? Any integrations using it will start returning 401 immediately."
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/60 bg-rose-900/30 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-900/50 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Revoke
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* One-time secret modal */}
      {rawKey && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New API key"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div className="relative w-full max-w-lg rounded-xl border border-violet-700/60 bg-gray-950 p-6 shadow-2xl">
            <button
              type="button"
              onClick={closeModal}
              aria-label="Close"
              className="absolute top-3 right-3 p-1 text-gray-500 hover:text-gray-200"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-300" />
              <h3 className="text-base font-semibold text-white">Copy your key now</h3>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              This is the only time the raw key will be shown. Once you close this
              dialog we only retain its hash — if you lose it you must generate a
              new one.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <input
                readOnly
                value={rawKey}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-xs text-gray-100 font-mono"
              />
              <button
                type="button"
                onClick={copyKey}
                className="inline-flex items-center gap-1.5 rounded-md border border-violet-700/60 bg-violet-950/40 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-900/40 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="mt-4 rounded-md border border-pvx-border bg-pvx-surface/40 px-3 py-2 text-[11px] text-gray-400">
              Use as <span className="font-mono text-gray-200">x-kinvox-api-key</span> header on POST <span className="font-mono text-gray-200">/api/v1/signals/capture</span>.
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                Done, I saved it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year:   'numeric',
      month:  'short',
      day:    'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
