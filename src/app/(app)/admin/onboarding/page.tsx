import { createAdminClient } from '@/lib/supabase/admin'
import OrgRow from './OrgRow'

interface OrgWithOwner {
  id: string
  name: string
  slug: string
  plan: string
  subscription_status: 'unpaid' | 'trialing' | 'active' | 'past_due' | 'canceled'
  owner_id: string
  stripe_customer_id: string | null
  created_at: string
  owner_email: string | null
}

export const dynamic = 'force-dynamic'

export default async function AdminOnboardingPage() {
  const admin = createAdminClient()

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, name, slug, plan, subscription_status, owner_id, stripe_customer_id, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg p-4">
        Failed to load organizations: {error.message}
      </div>
    )
  }

  // Fetch owner emails in one call via admin auth API
  const ownerIds = [...new Set((orgs ?? []).map(o => o.owner_id))]
  const emailMap: Record<string, string> = {}

  await Promise.all(
    ownerIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      if (data?.user?.email) emailMap[uid] = data.user.email
    })
  )

  const rows: OrgWithOwner[] = (orgs ?? []).map(org => ({
    ...org,
    subscription_status: org.subscription_status as OrgWithOwner['subscription_status'],
    owner_email: emailMap[org.owner_id] ?? null,
  }))

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-white">Organization Onboarding</h1>
        <p className="text-sm text-gray-400 mt-1">
          {rows.length} organization{rows.length !== 1 ? 's' : ''} total
        </p>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-500">
              <th className="px-4 py-3 text-left font-medium">Organization</th>
              <th className="px-4 py-3 text-left font-medium">Plan</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Owner Email</th>
              <th className="px-4 py-3 text-left font-medium">Stripe ID</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  No organizations yet.
                </td>
              </tr>
            ) : (
              rows.map(org => <OrgRow key={org.id} {...org} />)
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-600">
        Note: &quot;Send Invite&quot; uses <code className="text-gray-500">supabase.auth.admin.inviteUserByEmail()</code> and
        requires <code className="text-gray-500">SUPABASE_SERVICE_ROLE_KEY</code> to be set in <code className="text-gray-500">.env.local</code>.
      </p>
    </div>
  )
}
