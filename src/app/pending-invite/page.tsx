import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logout } from '../(auth)/actions'
import Logo from '@/components/Logo'

export const dynamic = 'force-dynamic'

// Landing page for authenticated users who have no organization
// and no pending invite. Kinvox is invite-only — the org must
// be pre-provisioned by Admin HQ before the invite email is sent.
export default async function PendingInvitePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, organizations(slug)')
    .eq('id', user.id)
    .single<{
      organization_id: string | null
      organizations: { slug: string | null } | null
    }>()

  if (profile?.organization_id && profile.organizations?.slug) {
    redirect(`/${profile.organizations.slug}`)
  }

  const { data: invite } = await supabase
    .rpc('current_user_invited_org')
    .maybeSingle<{ org_id: string }>()
  if (invite) redirect('/onboarding')

  return (
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
  )
}
