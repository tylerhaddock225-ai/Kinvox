import { redirect } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation } from '@/lib/impersonation'
import SignalsBoard from '@/components/signals/SignalsBoard'
import type { PendingSignal } from '@/lib/types/database.types'

export const dynamic = 'force-dynamic'

export default async function SignalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve which org this caller is acting on (matches the pattern used
  // by settings/leads/etc). HQ admins impersonating a tenant see that
  // tenant's queue; RLS on pending_signals does the same gating a
  // second time at query-time.
  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single<{ organization_id: string | null }>(),
    resolveImpersonation(),
  ])

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null
  if (!effectiveOrgId) redirect('/onboarding')

  const { data: signals } = await supabase
    .from('pending_signals')
    .select('id, organization_id, raw_text, ai_draft_reply, reasoning_snippet, intent_score, platform, status, external_post_id, created_at')
    .eq('organization_id', effectiveOrgId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<PendingSignal[]>()

  const initial = signals ?? []

  return (
    <div className="px-8 py-8 space-y-6 max-w-5xl">
      <header>
        <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
          Signal Review
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-300" />
          Pending Signals
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          The AI listens, drafts a reply, and parks it here. Approve to send, edit first, or dismiss.
        </p>
      </header>

      {/* SignalsBoard owns the list + realtime subscription; it handles
          the empty state internally so the page doesn't unmount the
          subscription when the queue is drained. */}
      <SignalsBoard organizationId={effectiveOrgId} initial={initial} />
    </div>
  )
}
