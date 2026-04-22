import Link from 'next/link'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-pvx-bg text-gray-100">
      <header className="border-b border-gray-800">
        <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
          <Link href="/" className="text-xl font-semibold tracking-tight">Kinvox</Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/apply" className="text-gray-300 hover:text-white">Apply</Link>
            <a
              href={`${APP_URL}/login`}
              className="rounded-lg bg-white/10 hover:bg-white/20 px-4 py-2 font-medium"
            >
              Sign in
            </a>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-800 py-6 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Kinvox — Built for Oklahoma City.
      </footer>
    </div>
  )
}
