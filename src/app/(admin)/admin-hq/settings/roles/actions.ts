'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  HQ_PERMISSION_KEYS,
  hasHqPermission,
  type HqPermissions,
} from '@/lib/permissions'

export type HqRoleActionState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

// ── Auth guard ─────────────────────────────────────────────────────────────
// Only HQ staff whose currently-assigned role has `manage_global_roles`
// can CRUD the HQ-global role catalogue. Everyone else bounces to /login —
// a deliberate fail-closed default.

async function requireHqRoleManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role, role:roles(permissions)')
    .eq('id', user.id)
    .single<{
      system_role: string | null
      role: { permissions: unknown } | null
    }>()

  if (!profile?.system_role) redirect('/login')
  if (!hasHqPermission(profile, 'manage_global_roles')) redirect('/admin-hq')

  return supabase
}

// ── Parser ────────────────────────────────────────────────────────────────
function parseHqPermissions(formData: FormData): HqPermissions {
  return Object.fromEntries(
    HQ_PERMISSION_KEYS.map(({ key }) => [key, formData.get(key) === 'on'])
  ) as HqPermissions
}

// ── Create ────────────────────────────────────────────────────────────────
export async function createHqRole(
  _prev: HqRoleActionState,
  formData: FormData,
): Promise<HqRoleActionState> {
  const supabase = await requireHqRoleManager()

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { status: 'error', error: 'Role name is required' }

  const { error } = await supabase.from('roles').insert({
    organization_id: null,
    name,
    permissions: parseHqPermissions(formData),
    is_system_role: false,
  })
  if (error) return { status: 'error', error: error.message }

  revalidatePath('/admin-hq/settings/roles')
  return { status: 'success' }
}

// ── Update ────────────────────────────────────────────────────────────────
export async function updateHqRole(
  _prev: HqRoleActionState,
  formData: FormData,
): Promise<HqRoleActionState> {
  const supabase = await requireHqRoleManager()

  const roleId = String(formData.get('role_id') ?? '')
  const name   = String(formData.get('name')    ?? '').trim()
  if (!roleId) return { status: 'error', error: 'Missing role id' }
  if (!name)   return { status: 'error', error: 'Role name is required' }

  const { error } = await supabase.from('roles')
    .update({ name, permissions: parseHqPermissions(formData) })
    .eq('id', roleId)
    .is('organization_id', null)
  if (error) return { status: 'error', error: error.message }

  revalidatePath('/admin-hq/settings/roles')
  return { status: 'success' }
}

// ── Delete ────────────────────────────────────────────────────────────────
export async function deleteHqRole(formData: FormData): Promise<void> {
  const supabase = await requireHqRoleManager()

  const roleId = String(formData.get('role_id') ?? '')
  if (!roleId) return

  // Unassign any HQ staff still pointing at this role — keeps the FK clean.
  await supabase.from('profiles')
    .update({ role_id: null })
    .eq('role_id', roleId)

  await supabase.from('roles')
    .delete()
    .eq('id', roleId)
    .is('organization_id', null)

  revalidatePath('/admin-hq/settings/roles')
}
