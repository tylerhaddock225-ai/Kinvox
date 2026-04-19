import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'

type SystemRole = 'platform_owner' | 'platform_support'

export default async function AdminHqLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single<{ system_role: SystemRole | null }>()

  if (!profile?.system_role) redirect('/dashboard')

  return (
    <div className="flex h-full min-h-screen bg-pvx-bg text-slate-100">
      <AdminSidebar systemRole={profile.system_role} />
      <main className="flex-1 overflow-y-auto">
        <div className="px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
