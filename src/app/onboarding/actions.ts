'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function createOrganization(formData: FormData) {
  // User-scoped client — respects RLS for org insert
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const name = formData.get('name') as string
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  // ── Step 1: Insert the organization ───────────────────────────
  // RLS policy "organizations: insert as owner" allows this because
  // owner_id = auth.uid(). No .select() chained — avoids the SELECT
  // policy check before the profile is linked.
  const { error: orgError } = await supabase
    .from('organizations')
    .insert({ name, slug, owner_id: user.id, plan: 'free' })

  if (orgError) return { error: `Failed to create organization: ${orgError.message}` }

  // ── Step 2: Fetch the new org id ──────────────────────────────
  // "organizations: select member or owner" allows this via owner_id = auth.uid().
  const { data: org, error: fetchError } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .eq('owner_id', user.id)
    .single()

  if (fetchError || !org) {
    return { error: `Could not retrieve organization: ${fetchError?.message ?? 'unknown error'}` }
  }

  // ── Step 3: Link profile to org via service-role client ───────
  // Using the admin client here completely bypasses RLS, eliminating
  // any possibility of the profiles SELECT policy causing recursion
  // during the UPDATE's implicit row-lookup phase.
  const admin = createAdminClient()

  const { error: profileError } = await admin
    .from('profiles')
    .update({ organization_id: org.id, role: 'admin' })
    .eq('id', user.id)

  if (profileError) return { error: `Failed to update profile: ${profileError.message}` }

  revalidatePath('/', 'layout')
  redirect('/')
}
