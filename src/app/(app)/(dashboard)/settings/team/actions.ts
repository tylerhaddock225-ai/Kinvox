'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { PERMISSION_KEYS, type Permissions } from '@/lib/permissions'

export type TeamActionState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// ── Shared auth helper ───────────────────────────────────────────────────────

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.organization_id || profile.role !== 'admin') return null
  return { supabase, orgId: profile.organization_id }
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function inviteMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const email    = (formData.get('email') as string).trim().toLowerCase()
  const fullName = ((formData.get('full_name') as string) ?? '').trim() || null
  const roleId   = (formData.get('role_id') as string) || null

  if (!email) return { status: 'error', error: 'Email is required' }

  const admin = createAdminClient()

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName ?? '' },
  })
  if (error) return { status: 'error', error: error.message }

  // Profile is auto-created by the handle_new_user trigger.
  // Assign them to this org with the chosen custom role.
  await admin.from('profiles').update({
    organization_id: ctx.orgId,
    full_name: fullName,
    role: 'agent',
    role_id: roleId,
  }).eq('id', data.user.id)

  revalidatePath('/settings/team')
  return { status: 'success' }
}

export async function updateMemberRole(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const memberId = formData.get('member_id') as string
  const roleId   = (formData.get('role_id') as string) || null

  const admin = createAdminClient()
  await admin.from('profiles')
    .update({ role_id: roleId })
    .eq('id', memberId)
    .eq('organization_id', ctx.orgId)

  revalidatePath('/settings/team')
}

// ── Roles ────────────────────────────────────────────────────────────────────

function parsePermissions(formData: FormData): Permissions {
  return Object.fromEntries(
    PERMISSION_KEYS.map(({ key }) => [key, formData.get(key) === 'on'])
  ) as Permissions
}

export async function createRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const name = (formData.get('name') as string).trim()
  if (!name) return { status: 'error', error: 'Role name is required' }

  const { error } = await ctx.supabase.from('roles').insert({
    organization_id: ctx.orgId,
    name,
    permissions: parsePermissions(formData),
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/settings/team')
  return { status: 'success' }
}

export async function updateRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const ctx = await requireAdmin()
  if (!ctx) return { status: 'error', error: 'Unauthorized' }

  const roleId = formData.get('role_id') as string
  const name   = (formData.get('name') as string).trim()
  if (!name) return { status: 'error', error: 'Role name is required' }

  const { error } = await ctx.supabase.from('roles')
    .update({ name, permissions: parsePermissions(formData) })
    .eq('id', roleId)
    .eq('organization_id', ctx.orgId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath('/settings/team')
  return { status: 'success' }
}

export async function deleteRole(formData: FormData): Promise<void> {
  const ctx = await requireAdmin()
  if (!ctx) return

  const roleId = formData.get('role_id') as string

  // Unassign anyone using this role before deleting
  await ctx.supabase.from('profiles')
    .update({ role_id: null })
    .eq('role_id', roleId)
    .eq('organization_id', ctx.orgId)

  await ctx.supabase.from('roles')
    .delete()
    .eq('id', roleId)
    .eq('organization_id', ctx.orgId)

  revalidatePath('/settings/team')
}
