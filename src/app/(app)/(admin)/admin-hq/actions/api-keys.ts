'use server'

import { createHash, randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function requireHqAdmin() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const { data: isAdmin } = await supabase.rpc('is_admin_hq')
  if (!isAdmin || !auth.user) redirect('/login')
  return { supabase, userId: auth.user.id }
}

function integrationsTab(orgId: string, extra = ''): string {
  const base = `/admin-hq/organizations/${orgId}?tab=integrations-billing`
  return extra ? `${base}&${extra}` : base
}

function generateRawKey(): string {
  // 32 random bytes → URL-safe base64 (no padding). The 'kvx_' prefix makes
  // the key self-identifying when it leaks into logs / Slack / etc.
  const body = randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `kvx_${body}`
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Mints a new signal API key for the target org. Raw key is returned to
 * the caller exactly once via the `new_key` flash param — after this
 * server action returns, only the hash survives in the database.
 */
export async function generateApiKey(formData: FormData) {
  const { supabase, userId } = await requireHqAdmin()

  const orgId = String(formData.get('org_id') ?? '').trim()
  const label = String(formData.get('label')  ?? '').trim() || null
  if (!orgId) redirect('/admin-hq/organizations')

  const raw      = generateRawKey()
  const key_hash = sha256Hex(raw)

  const { error } = await supabase
    .from('organization_api_keys')
    .insert({
      organization_id: orgId,
      key_hash,
      label,
      created_by: userId,
    })

  if (error) {
    redirect(integrationsTab(orgId, 'key_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  // new_key lives in the URL only for the immediate redirect; the client
  // component shows it in a one-shot modal and never re-renders it.
  redirect(integrationsTab(orgId, 'new_key=' + encodeURIComponent(raw)))
}

export async function revokeApiKey(formData: FormData) {
  const { supabase } = await requireHqAdmin()

  const orgId = String(formData.get('org_id') ?? '').trim()
  const keyId = String(formData.get('key_id') ?? '').trim()
  if (!orgId || !keyId) redirect('/admin-hq/organizations')

  const { error } = await supabase
    .from('organization_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('organization_id', orgId)

  if (error) {
    redirect(integrationsTab(orgId, 'key_error=' + encodeURIComponent(error.message)))
  }

  revalidatePath(`/admin-hq/organizations/${orgId}`)
  redirect(integrationsTab(orgId, 'key_revoked=1'))
}
