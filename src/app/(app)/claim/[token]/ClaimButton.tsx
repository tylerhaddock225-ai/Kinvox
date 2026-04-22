'use client'

import { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

// Redeem the claim, then hard-navigate to the new org dashboard so the
// middleware sorting-hat re-evaluates with the fresh profile.organization_id
// that the RPC just stamped. A client-side router.push() would keep the
// stale session snapshot until the next full page load.
export default function ClaimButton({
  token,
  orgName,
}: {
  token:   string
  orgName: string
}) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [error, setError]   = useState<string | null>(null)

  async function handleClaim() {
    setStatus('submitting')
    setError(null)

    const { data, error: rpcErr } = await supabase.rpc('redeem_organization_claim', {
      claim_token_raw: token,
    })

    if (rpcErr) {
      setError(rpcErr.message ?? 'Claim failed — please contact support.')
      setStatus('error')
      return
    }

    // Fetch the org's slug so we can land on the tenant dashboard.
    const { data: org } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', data as string)
      .single<{ slug: string | null }>()

    // Hard navigation so middleware re-runs with the updated profile.
    window.location.href = org?.slug ? `/${org.slug}` : '/'
  }

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={handleClaim}
        disabled={status === 'submitting'}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white transition-colors"
      >
        {status === 'submitting' && <Loader2 className="w-4 h-4 animate-spin" />}
        {status === 'submitting' ? 'Claiming…' : `Claim ${orgName}`}
      </button>
    </div>
  )
}
