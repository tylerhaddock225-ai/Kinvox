import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/auth/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[hq-invite]'

// PATCH /api/auth/hq-invite — redeem an HQ user invitation: validate the token,
// provision/attach the user, set their password, and stamp the invitation
// accepted. The HQ parallel of api/auth/accept-invite, with one critical
// difference: it writes profiles.system_role (the FIRST app-code system_role
// write) with organization_id = NULL.
//
// CONSTRAINT-CRITICAL: organization_id MUST be NULL. profiles_no_dual_positive
// — CHECK (NOT (system_role IS NOT NULL AND organization_id IS NOT NULL)) —
// rejects any row carrying system_role alongside a non-null org. profiles.role is
// NOT NULL; K2c-C added a dedicated 'hq' value to profiles_role_check, so HQ users
// now carry the honest role='hq' (a borrowed 'admin' from J2 until K2c-C). It is
// inert for tenant access either way — every tenant RLS path also requires a
// matching org, which an org-null HQ user never has — and nothing reads
// profiles.role for HQ rows (HQ gating keys on system_role).
export async function PATCH(request: NextRequest) {
  let body: { token?: unknown; password?: unknown; full_name?: unknown }
  try {
    body = await request.json() as { token?: unknown; password?: unknown; full_name?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token    = typeof body.token === 'string' ? body.token : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''

  if (!token)              return NextResponse.json({ error: 'Missing invitation token' }, { status: 400 })
  if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  if (!fullName)           return NextResponse.json({ error: 'Full name is required.' }, { status: 400 })

  const supabase  = createAdminClient()
  const tokenHash = hashToken(token)

  const { data: row, error: lookupErr } = await supabase
    .from('hq_invitations')
    .select('id, email, system_role, role_id, expires_at, accepted_at')
    .eq('token_hash', tokenHash)
    .maybeSingle<{
      id:          string
      email:       string
      system_role: string
      role_id:     string | null
      expires_at:  string
      accepted_at: string | null
    }>()

  if (lookupErr) {
    console.error(`${LOG} invitation lookup failed: ${lookupErr.message}`)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!row)            return NextResponse.json({ error: 'Invalid or expired invitation link' }, { status: 400 })
  if (row.accepted_at) return NextResponse.json({ error: 'This invitation has already been accepted' }, { status: 400 })
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })
  }

  const email: string = row.email

  // The HQ profile shape. organization_id MUST be null (profiles_no_dual_positive);
  // role is the honest 'hq' sentinel (K2c-C; see header).
  const hqProfile = {
    system_role:     row.system_role,
    organization_id: null,
    role_id:         row.role_id,
    role:            'hq',
  }

  // auth.users isn't reachable via PostgREST — resolve email → user through the
  // GoTrue admin API (mirror accept-invite / Stage 1a listUsers pattern).
  const { data: userList, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listErr) {
    console.error(`${LOG} listUsers failed: ${listErr.message}`)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  const existingUser = userList.users.find(u => u.email?.toLowerCase() === email.toLowerCase())

  let userId: string

  if (!existingUser) {
    // ── New user ───────────────────────────────────────────────────────────
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createErr || !created?.user) {
      console.error(`${LOG} createUser failed for ${email}: ${createErr?.message}`)
      return NextResponse.json({ error: createErr?.message ?? 'Could not create account' }, { status: 500 })
    }
    userId = created.user.id

    // handle_new_user created the profile (role defaults to 'agent', org null);
    // promote it to HQ. maybeSingle surfaces rows-affected so a zero-row update
    // (profile not present yet) falls back to an INSERT.
    const { data: updated, error: updErr } = await supabase
      .from('profiles')
      .update({ ...hqProfile, full_name: fullName })
      .eq('id', userId)
      .select('id')
      .maybeSingle()
    if (updErr) {
      console.error(`${LOG} profile promote failed for ${userId}: ${updErr.message}`)
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
    if (!updated) {
      const { error: insErr } = await supabase
        .from('profiles')
        .insert({ id: userId, ...hqProfile, full_name: fullName })
      if (insErr) {
        console.error(`${LOG} profile insert (new-user fallback) failed for ${userId}: ${insErr.message}`)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
  } else {
    // ── Existing user ──────────────────────────────────────────────────────
    userId = existingUser.id

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, organization_id, system_role')
      .eq('id', userId)
      .maybeSingle<{ id: string; organization_id: string | null; system_role: string | null }>()
    if (profErr) {
      console.error(`${LOG} profile lookup failed for ${userId}: ${profErr.message}`)
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    // A tenant member can't be converted to HQ — nulling their org would strand
    // them, and system_role + org would violate profiles_no_dual_positive.
    if (profile?.organization_id) {
      return NextResponse.json(
        { error: 'This email belongs to a tenant organization and cannot be provisioned as HQ staff.' },
        { status: 400 },
      )
    }
    if (profile?.system_role) {
      return NextResponse.json({ error: "You're already an HQ user" }, { status: 400 })
    }

    // Orphan profile (no org, no system_role) — set the password + promote.
    const { error: updUserErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { full_name: fullName },
    })
    if (updUserErr) {
      console.error(`${LOG} updateUserById failed for ${userId}: ${updUserErr.message}`)
      return NextResponse.json({ error: updUserErr.message }, { status: 500 })
    }

    if (profile) {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ ...hqProfile, full_name: fullName })
        .eq('id', userId)
      if (updErr) {
        console.error(`${LOG} profile promote failed for ${userId}: ${updErr.message}`)
        return NextResponse.json({ error: updErr.message }, { status: 500 })
      }
    } else {
      const { error: insErr } = await supabase
        .from('profiles')
        .insert({ id: userId, ...hqProfile, full_name: fullName })
      if (insErr) {
        console.error(`${LOG} profile insert failed for ${userId}: ${insErr.message}`)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
  }

  // Stamp acceptance. The `accepted_at IS NULL` guard makes double-redeem races
  // a no-op on the second writer.
  const { error: acceptErr } = await supabase
    .from('hq_invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq('id', row.id)
    .is('accepted_at', null)
  if (acceptErr) {
    console.error(`${LOG} accept stamp failed for invitation=${row.id}: ${acceptErr.message}`)
    return NextResponse.json({ error: acceptErr.message }, { status: 500 })
  }

  console.log(`${LOG} accepted invitation=${row.id} user=${userId} system_role=${row.system_role}`)
  return NextResponse.json({ ok: true, email }, { status: 200 })
}
