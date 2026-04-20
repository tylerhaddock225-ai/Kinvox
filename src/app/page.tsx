import AuthLoading from '@/components/AuthLoading'

// The centralized sorting hat in src/lib/supabase/middleware.ts
// handles ALL role-based routing. This page only renders on the
// rare edge where middleware returned NextResponse.next() for `/`
// (e.g. the profile lookup threw) — in which case we show the
// shared loading surface rather than a stale pending-invite UI.
//
// force-dynamic + revalidate = 0 ensure this never gets cached
// and the middleware runs fresh on every hit.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function RootPage() {
  return <AuthLoading label="Redirecting…" />
}
