import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/auth/tokens'
import { getRoleLabel } from '@/lib/types/auth'
import HqInviteAcceptForm from './HqInviteAcceptForm'

export const dynamic = 'force-dynamic'

type HqInvitation = {
  id:          string
  email:       string
  full_name:   string | null
  system_role: string
  role_id:     string | null
  expires_at:  string
  accepted_at: string | null
  roles:       { name: string } | null
}

export default async function HqInviteLandingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Admin client for the lookup — hq_invitations is HQ-scope in RLS and this
  // page is public. We hash the URL token and match on token_hash; the raw token
  // is never exposed beyond the inbound URL. Mirrors invite/[token]/page.tsx.
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('hq_invitations')
    .select('id, email, full_name, system_role, role_id, expires_at, accepted_at, roles(name)')
    .eq('token_hash', hashToken(token))
    .maybeSingle<HqInvitation>()

  // Most-specific failure wins so the copy tells the user what happened.
  // force-dynamic server component (re-rendered per request), so reading the
  // clock here is safe — the purity lint can't tell RSC from a client render.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()
  const state: 'invalid' | 'accepted' | 'expired' | 'valid' =
    !invite                                        ? 'invalid'
    : invite.accepted_at                           ? 'accepted'
    : new Date(invite.expires_at).getTime() < now  ? 'expired'
    :                                                'valid'

  const expiredOn = invite
    ? new Date(invite.expires_at).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })
    : ''

  // Prefer the assigned HQ permission-bag role name; fall back to the
  // system_role label so the invitee always sees what they're being granted.
  const roleLabel = invite?.roles?.name ?? (invite ? getRoleLabel(invite.system_role) : null)

  return (
    <main className="min-h-screen flex items-center justify-center bg-pvx-bg px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-pvx-border bg-gray-900/80 p-7 shadow-xl">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.25em] text-emerald-400 uppercase">
          <Zap className="w-3.5 h-3.5 fill-emerald-400" />
          Kinvox HQ
        </div>

        {state === 'invalid' && (
          <div className="mt-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-lg font-semibold text-white">Invitation not recognized</h1>
              <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                This link is invalid or no longer available.
              </p>
            </div>
          </div>
        )}

        {state === 'accepted' && (
          <>
            <div className="mt-6 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h1 className="text-lg font-semibold text-white">Already accepted</h1>
                <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                  You&apos;ve already accepted this invitation.
                </p>
              </div>
            </div>
            <Link
              href="/login"
              className="mt-6 w-full inline-flex items-center justify-center rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              Sign in
            </Link>
          </>
        )}

        {state === 'expired' && (
          <div className="mt-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-lg font-semibold text-white">Invitation expired</h1>
              <p className="mt-1 text-sm text-gray-400 leading-relaxed">
                This invitation expired on {expiredOn}. Ask whoever invited you to send a new one.
              </p>
            </div>
          </div>
        )}

        {state === 'valid' && invite && (
          <HqInviteAcceptForm
            token={token}
            email={invite.email}
            defaultFullName={invite.full_name}
            roleName={roleLabel}
          />
        )}

        <p className="mt-8 text-center text-[10px] text-gray-600">
          Powered by Kinvox
        </p>
      </div>
    </main>
  )
}
