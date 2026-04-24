import { Suspense } from 'react'
import SidebarServer from '@/components/SidebarServer'
import Sidebar from '@/components/Sidebar'
import GlobalSearch from '@/components/GlobalSearch'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Suspense fallback={<Sidebar />}>
        <SidebarServer />
      </Suspense>
      <main className="flex-1 overflow-y-auto bg-pvx-bg flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-center border-b border-pvx-border bg-pvx-bg/80 backdrop-blur px-8 py-3">
          <GlobalSearch />
        </header>
        <div className="flex-1">
          {children}
        </div>
      </main>
    </div>
  )
}
