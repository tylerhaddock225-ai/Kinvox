'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId } from '@/lib/impersonation'

export type DisconnectSocialState =
  | { status: 'success'; platform: string }
  | { status: 'error';   error: string }
  | null

const ALLOWED: ReadonlyArray<'reddit' | 'x' | 'facebook' | 'threads'> = [
  'reddit', 'x', 'facebook', 'threads',
]

// Tenant-side disconnect for a connected social platform. Flips
// organization_credentials.status='revoked' so subsequent writer paths
// (the Reddit reply route, etc.) get 'credential_not_found' from
// get_decrypted_credential and surface a "not connected" error.
//
// We don't delete the row or clear the vault secret — leaving the
// secret in place keeps a re-connect UX cheap and gives us an audit
// trail. The vault entry will be overwritten in place on the next
// successful set_organization_credential() call for the same (org,
// platform) pair.
//
// Auth: requires a tenant-admin OR an HQ admin acting via
// resolveImpersonation. We use the admin client for the UPDATE because
// organization_credentials has no tenant-side UPDATE policy by design.
export async function disconnectSocialPlatform(
  _prev: DisconnectSocialState,
  formData: FormData,
): Promise<DisconnectSocialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const platformRaw = String(formData.get('platform') ?? '').trim()
  if (!ALLOWED.includes(platformRaw as (typeof ALLOWED)[number])) {
    return { status: 'error', error: 'Invalid platform' }
  }
  const platform = platformRaw as (typeof ALLOWED)[number]

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single<{ organization_id: string | null; role: string | null }>()

  const impersonating = profile?.organization_id !== orgId
  if (!impersonating && profile?.role !== 'admin') {
    return { status: 'error', error: 'Only org admins can disconnect social accounts' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_credentials')
    .update({ status: 'revoked' })
    .eq('organization_id', orgId)
    .eq('platform', platform)
    .eq('status', 'active')

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/[orgSlug]/settings/integrations', 'page')
  return { status: 'success', platform }
}
