'use client'

import { usePathname } from 'next/navigation'

// Mirror Sidebar.tsx RESERVED_TOP — these are top-level path segments that
// are NEVER an org slug, so the hook returns null when pathname starts with
// one. If RESERVED_TOP changes in Sidebar.tsx, update this set in lockstep.
// (Backlog: extract a shared constant when either file is touched again.)
const RESERVED = new Set([
  'leads', 'signals', 'settings', 'support',
  'login', 'signup', 'forgot-password', 'reset-password',
  'onboarding', 'admin', 'hq', 'api',
])

/**
 * Returns the org slug from the current URL when on a tenant-scoped route,
 * or null when on a reserved top-level route (login, hq, etc.) or when the
 * pathname can't be resolved. Used by client components that need to
 * construct scoped navigation URLs without prop-drilling.
 *
 * Server components should pull orgSlug from route params directly — this
 * hook is the client-side fallback.
 */
export function useOrgSlug(): string | null {
  const pathname = usePathname()
  if (!pathname) return null
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first) return null
  if (RESERVED.has(first)) return null
  return first
}
