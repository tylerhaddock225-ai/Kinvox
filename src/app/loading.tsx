import AuthLoading from '@/components/AuthLoading'

// Next.js app-level loading.tsx — rendered automatically as the Suspense
// fallback whenever a route segment is streaming. Prevents the
// /pending-invite (or any other) skeleton from briefly flashing while
// the sorting hat in src/app/page.tsx resolves.
export default function RootLoading() {
  return <AuthLoading />
}
