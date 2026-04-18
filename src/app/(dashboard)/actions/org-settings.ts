'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { createSenderSignature } from '@/lib/postmark-admin'
import { generateInboundEmail } from '@/lib/org-utils'

type State =
  | { status: 'success'; message?: string }
  | { status: 'error';   error: string }
  | null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Org Owner OR a system 'admin' role can edit support settings.
// Returns { ok: true } or { ok: false, error } so callers can fail uniformly.
async function requireSettingsAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id) return { ok: false as const, error: 'No organization' }

  const { data: org } = await supabase
    .from('organizations')
    .select('id, owner_id')
    .eq('id', profile.organization_id)
    .single()

  if (!org) return { ok: false as const, error: 'Organization not found' }

  const isOwner      = org.owner_id === user.id
  const isSuperAdmin = profile.role === 'admin'
  if (!isOwner && !isSuperAdmin) {
    return { ok: false as const, error: 'You do not have permission to change support settings' }
  }

  return { ok: true as const, userId: user.id, orgId: org.id, ownerName: profile.role }
}

export async function updateSupportEmail(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const email = (formData.get('support_email') as string | null)?.trim() ?? ''
  if (!email) return { status: 'error', error: 'Support email is required' }
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Enter a valid email address' }

  // Pull the org name to use as the Sender Signature display name in Postmark.
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', guard.orgId)
    .single()

  // a) Persist the new email and reset the confirmation timestamp — the
  //    customer must re-verify each address change.
  const { error: updErr } = await supabase
    .from('organizations')
    .update({
      verified_support_email:              email,
      verified_support_email_confirmed_at: null,
    })
    .eq('id', guard.orgId)

  if (updErr) return { status: 'error', error: updErr.message }

  // b) Trigger the Postmark verification email. If Postmark rejects the
  //    request we surface the error but leave the DB update in place so
  //    the user can retry without re-entering the address.
  try {
    await createSenderSignature(email, org?.name ?? 'Kinvox Support')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to request verification'
    return { status: 'error', error: msg }
  }

  revalidatePath('/settings/team')
  return { status: 'success', message: `Verification email sent to ${email}.` }
}

export async function initializeInboundEmail(_prev: State, _formData: FormData): Promise<State> {
  const supabase = await createClient()

  const guard = await requireSettingsAdmin(supabase)
  if (!guard.ok) return { status: 'error', error: guard.error }

  const { data: org } = await supabase
    .from('organizations')
    .select('name, inbound_email_address')
    .eq('id', guard.orgId)
    .single()

  if (!org) return { status: 'error', error: 'Organization not found' }
  if (org.inbound_email_address) {
    // Already set — treat as success so the UI can refresh without an error toast.
    return { status: 'success', message: 'Inbound address already assigned.' }
  }

  // Retry a few times in case the random hash collides with the unique index.
  let lastError: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInboundEmail(org.name)
    const { error } = await supabase
      .from('organizations')
      .update({ inbound_email_address: candidate })
      .eq('id', guard.orgId)
      .is('inbound_email_address', null)   // only set if still unset (avoid clobber)

    if (!error) {
      revalidatePath('/settings/team')
      return { status: 'success', message: `Forwarding address ${candidate} is ready.` }
    }
    lastError = error.message
    // 23505 → unique violation; loop and try a fresh hash. Anything else: give up.
    if (!/duplicate key|23505|already exists/i.test(error.message)) break
  }

  return { status: 'error', error: lastError ?? 'Failed to generate inbound address' }
}
