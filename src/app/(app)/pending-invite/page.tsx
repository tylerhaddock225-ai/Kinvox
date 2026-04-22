import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from '../(auth)/actions'
import Logo from '@/components/Logo'
import PendingInviteGate from './PendingInviteGate'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The centralized middleware sorting hat guarantees that only
// authenticated users without an HQ role, without an org, and
// without a pending invite reach this page. We only need to:
//   • confirm the session (defensive — middleware already gated).
//   • render the "Pending invitation" UI, inside the client gate
//     that re-checks role on the client for final flicker-proofing.
export default async function PendingInvitePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <PendingInviteGate>
      <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
        <div className="w-full max-w-md">

          <div className="flex items-center justify-center gap-3 mb-10">
            <Logo size={36} />
            <span className="text-xl font-semibold text-white">Kinvox</span>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <h1 className="text-xl font-bold text-white">Pending invitation</h1>
            <p className="text-sm text-gray-400 mt-3">
              <span className="text-gray-300">{user.email}</span> isn&apos;t linked to a
              workspace yet. Kinvox is invite-only — once your organization is
              provisioned, we&apos;ll send an invitation email with a link to join.
            </p>
            <p className="text-sm text-gray-400 mt-4">
              Need help? Contact{' '}
              <a
                href="mailto:support@kinvox.com"
                className="text-emerald-400 hover:text-emerald-300"
              >
                support@kinvox.com
              </a>
              .
            </p>

            <form action={logout} className="mt-6">
              <button
                type="submit"
                className="text-xs text-gray-500 hover:text-gray-300 underline"
              >
                Sign out
              </button>
            </form>
          </div>

        </div>
      </div>
    </PendingInviteGate>
  )
}
