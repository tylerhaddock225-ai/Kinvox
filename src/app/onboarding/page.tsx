import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Logo from '@/components/Logo'
import AcceptInviteForm from './AcceptInviteForm'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// The centralized middleware sorting hat routes HQ staff and
// merchants away from /onboarding before they reach this page.
// Only invitees (auth.users.raw_user_meta_data.invited_to_org set)
// land here. The page just fetches the invite payload to render
// the accept screen; all role-based redirecting lives in middleware.
export default async function OnboardingPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: invite } = await supabase
    .rpc('current_user_invited_org')
    .maybeSingle<{ org_id: string; org_name: string; org_slug: string }>()

  // Defensive: if the invite row has vanished since middleware ran,
  // bounce back through / so the sorting hat can re-route.
  if (!invite) redirect('/')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-md">

        <div className="flex items-center justify-center gap-3 mb-10">
          <Logo size={36} />
          <span className="text-xl font-semibold text-white">Kinvox</span>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">Accept your invitation</h1>
            <p className="text-sm text-gray-400 mt-1">
              You&apos;ve been invited to join{' '}
              <span className="text-white font-medium">{invite.org_name}</span>.
            </p>
          </div>

          <AcceptInviteForm orgName={invite.org_name} />
        </div>

      </div>
    </div>
  )
}
