'use client'

// Reusable forwarding-address panel — both Support Settings (Tickets) and
// Lead Support tabs use this. The full plus-addressed email is computed
// server-side via constructInboundEmailAddress and passed in as `address`;
// the client never reads POSTMARK_INBOUND_ADDRESS directly. The DB stores
// only the per-tenant tag.
//
// Empty state → form with a Generate button that runs the channel-specific
// server action. Populated state → readonly input + Copy button.

import { useActionState, useState } from 'react'
import { Sparkles, Copy, CheckCircle2 } from 'lucide-react'

const INPUT  = 'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500'
const LABEL  = 'block text-xs font-medium text-gray-400 mb-1'
const BTN    = 'inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_PRIMARY   = `${BTN} bg-indigo-600 text-white hover:bg-indigo-500`
const BTN_SECONDARY = `${BTN} text-gray-400 hover:text-white`

// Mirror of the action state union used across the org-settings actions.
// Kept structural so we don't import a server-only module from a client one.
export type InboundActionState =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

type Props = {
  // Pre-constructed plus-addressed email, computed server-side. null when
  // the tenant hasn't generated one yet OR when POSTMARK_INBOUND_ADDRESS is
  // unset / malformed.
  address:    string | null
  // Channel-specific server action (initializeInboundEmail or
  // initializeLeadInboundEmail).
  action:     (prev: InboundActionState, formData: FormData) => Promise<InboundActionState>
  // Drives the helper-text snippet referencing the routing tag shape.
  tagPrefix:  'tk' | 'ld'
  // Panel heading, e.g. "Your Kinvox Forwarding Address".
  heading:    string
}

export default function InboundAddressRow({ address, action, tagPrefix, heading }: Props) {
  const [state, formAction, pending] = useActionState(action, null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — silently ignore
    }
  }

  const helperText =
    tagPrefix === 'tk'
      ? <>Forward inbound mail to this address; replies thread back into the matching ticket via the <code className="text-gray-400">[tk_…]</code> tag.</>
      : <>Forward inbound mail to this address; replies thread back into the matching lead conversation via the <code className="text-gray-400">[ld_…]</code> tag.</>

  return (
    <div className="rounded-xl border border-pvx-border bg-pvx-surface p-5 space-y-3">
      <label className={LABEL}>{heading}</label>

      {!address ? (
        <div className="space-y-2">
          <form action={formAction} className="flex gap-2">
            <input
              readOnly
              value="— not assigned yet —"
              className={INPUT + ' cursor-default opacity-60'}
            />
            <button type="submit" disabled={pending} className={BTN_PRIMARY + ' shrink-0'}>
              <Sparkles className="w-4 h-4" />
              {pending ? 'Generating…' : 'Generate Address'}
            </button>
          </form>
          {state?.status === 'error' && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex gap-2 items-stretch">
          <input
            readOnly
            value={address}
            className={INPUT + ' cursor-default font-mono text-xs'}
          />
          <button
            type="button"
            onClick={copy}
            title="Copy to clipboard"
            className={BTN_SECONDARY + ' shrink-0 border border-pvx-border hover:bg-white/5'}
          >
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      <p className="text-xs text-gray-500">{helperText}</p>
    </div>
  )
}
