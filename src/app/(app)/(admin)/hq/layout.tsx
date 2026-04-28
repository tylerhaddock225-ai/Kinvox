import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminGlobalSearch from '@/components/admin/AdminGlobalSearch'

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
      <main className="flex-1 overflow-y-auto flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-center border-b border-pvx-border bg-pvx-bg/80 backdrop-blur px-8 py-3">
          <AdminGlobalSearch />
        </header>
        <div className="flex-1 px-8 py-8">{children}</div>
      </main>
    </div>
  )
}
