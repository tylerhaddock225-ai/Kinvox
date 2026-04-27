import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { resolveImpersonation, type ImpersonationContext } from '@/lib/impersonation'

// Per-request cached auth + org context.
//
// React's cache() dedupes calls within a single React request, so a
// layout and the page it wraps can each call getAuthUser() /
// getOrgContext() and only one Supabase round-trip happens per layer.
//
// Functional behavior is identical to the open-coded versions these
// replace — callers still own redirects. We just stop paying for two
// round-trips of the same data on every settings nav.

type ProfileSlim = {
  organization_id: string | null
  role:            'admin' | 'agent' | 'viewer' | null
}

export type OrgContext = {
  user:           User
  profile:        ProfileSlim
  impersonation:  ImpersonationContext
  effectiveOrgId: string | null
}

export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

// Returns null when the caller isn't authenticated. Pages/layouts that
// require auth should redirect on null. Pages that need to enforce
// role='admin' do so themselves on top of this — getOrgContext stays
// gate-free so non-admin paths (e.g., billing, signals queue) can reuse it.
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await getAuthUser()
  if (!user) return null

  const supabase = await createClient()
  const [{ data: profile }, impersonation] = await Promise.all([
    supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single<ProfileSlim>(),
    resolveImpersonation(),
  ])

  const effectiveOrgId = impersonation.active
    ? impersonation.orgId
    : profile?.organization_id ?? null

  return {
    user,
    profile:        profile ?? { organization_id: null, role: null },
    impersonation,
    effectiveOrgId,
  }
})
