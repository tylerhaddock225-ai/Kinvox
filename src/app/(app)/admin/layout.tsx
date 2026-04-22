import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">Kinvox Admin</span>
          <span className="text-gray-700">|</span>
          <nav className="flex gap-4 text-sm text-gray-400">
            <Link href="/admin/onboarding" className="hover:text-white transition-colors">Onboarding</Link>
          </nav>
        </div>
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to app
        </Link>
      </header>
      <main className="px-6 py-8">{children}</main>
    </div>
  )
}
