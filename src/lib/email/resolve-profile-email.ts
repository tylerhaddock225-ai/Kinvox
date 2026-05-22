import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedProfileEmail {
  email:              string | null
  isInbox:            boolean
  inboxKind:          'lead' | null
  fromAddressSource:  'lead' | 'support' | 'platform'
}

/**
 * Resolves the deliverable email for a profile.
 *
 * Pseudo-agent inbox profiles (is_org_inbox=true) route to the org's verified
 * channel address (e.g., verified_lead_email) — not the synthetic
 * auth.users.email (which is @kinvox.internal and never receives mail).
 *
 * Real user profiles honor calendar_email override, then fall back to
 * auth.users.email via the admin API.
 *
 * Returns email=null when an inbox kind has no verified address yet (org has
 * not completed email verification) or when the profile cannot be found.
 * Callers must handle null gracefully — the helper does NOT throw.
 */
export async function resolveProfileEmail(
  supabase: SupabaseClient,
  profileId: string,
): Promise<ResolvedProfileEmail> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, is_org_inbox, org_inbox_kind, calendar_email')
    .eq('id', profileId)
    .maybeSingle()

  if (error || !profile) {
    return { email: null, isInbox: false, inboxKind: null, fromAddressSource: 'platform' }
  }

  // Pseudo-agent inbox path
  if (profile.is_org_inbox && profile.org_inbox_kind === 'lead') {
    if (!profile.organization_id) {
      return { email: null, isInbox: true, inboxKind: 'lead', fromAddressSource: 'lead' }
    }

    const { data: org } = await supabase
      .from('organizations')
      .select('verified_lead_email, verified_lead_email_confirmed_at')
      .eq('id', profile.organization_id)
      .maybeSingle()

    const verifiedEmail =
      org?.verified_lead_email && org?.verified_lead_email_confirmed_at
        ? (org.verified_lead_email as string)
        : null

    return {
      email:             verifiedEmail,
      isInbox:           true,
      inboxKind:         'lead',
      fromAddressSource: 'lead',
    }
  }

  // Real user path: calendar_email override > auth.users.email
  if (profile.calendar_email) {
    return {
      email:             profile.calendar_email as string,
      isInbox:           false,
      inboxKind:         null,
      fromAddressSource: 'support',
    }
  }

  const admin = createAdminClient()
  const { data: userRes } = await admin.auth.admin.getUserById(profileId)
  const authEmail = userRes?.user?.email ?? null

  return {
    email:             authEmail,
    isInbox:           false,
    inboxKind:         null,
    fromAddressSource: 'support',
  }
}
