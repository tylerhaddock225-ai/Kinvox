import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/auth/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[accept-invite]'

// PATCH /api/auth/accept-invite — redeem a member invitation: validate the
// token, provision/attach the user, set their password, and stamp the
// invitation accepted. Mirrors api/auth/reset-password's PATCH structure
// (admin client, hashToken lookup, same error shapes). Uses createAdminClient
// because member_invitations RLS blocks anonymous SELECT/UPDATE.
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
    .from('member_invitations')
    .select('id, organization_id, email, role_id, expires_at, accepted_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (lookupErr) {
    console.error(`${LOG} invitation lookup failed: ${lookupErr.message}`)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!row)             return NextResponse.json({ error: 'Invalid or expired invitation link' }, { status: 400 })
  if (row.accepted_at)  return NextResponse.json({ error: 'This invitation has already been accepted' }, { status: 400 })
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })
  }

  const email: string = row.email

  // auth.users isn't reachable via PostgREST, so resolve email → user through
  // the GoTrue admin API (mirror Stage 1a's listUsers pattern; same scaling
  // caveat — replace with a getUserByEmail RPC if the user base grows).
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

    // handle_new_user has created the profile with full_name from metadata;
    // attach the org + role.
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ organization_id: row.organization_id, role: 'agent', role_id: row.role_id })
      .eq('id', userId)
    if (updErr) {
      console.error(`${LOG} profile attach failed for ${userId}: ${updErr.message}`)
      return NextResponse.json({ error: updErr.message }, { status: 500 })
    }
  } else {
    // ── Existing user ──────────────────────────────────────────────────────
    userId = existingUser.id

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('id, organization_id')
      .eq('id', userId)
      .maybeSingle()
    if (profErr) {
      console.error(`${LOG} profile lookup failed for ${userId}: ${profErr.message}`)
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    const currentOrg: string | null = profile?.organization_id ?? null
    if (currentOrg && currentOrg !== row.organization_id) {
      return NextResponse.json(
        { error: 'This email already belongs to another organization. Multi-organization membership is not yet supported.' },
        { status: 400 },
      )
    }
    if (currentOrg && currentOrg === row.organization_id) {
      return NextResponse.json({ error: "You're already a member of this organization" }, { status: 400 })
    }

    // currentOrg is null (or profile missing) — set the password + attach.
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
        .update({ organization_id: row.organization_id, role: 'agent', role_id: row.role_id, full_name: fullName })
        .eq('id', userId)
      if (updErr) {
        console.error(`${LOG} profile attach failed for ${userId}: ${updErr.message}`)
        return NextResponse.json({ error: updErr.message }, { status: 500 })
      }
    } else {
      // Defensive: profile row missing (the bug class Stage 1a removed). The
      // handle_new_user trigger should always create it, but never assume.
      const { error: insErr } = await supabase
        .from('profiles')
        .insert({ id: userId, organization_id: row.organization_id, role: 'agent', role_id: row.role_id, full_name: fullName })
      if (insErr) {
        console.error(`${LOG} profile insert failed for ${userId}: ${insErr.message}`)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }
  }

  // Stamp acceptance. The `accepted_at IS NULL` guard makes double-redeem
  // races a no-op on the second writer.
  const { error: acceptErr } = await supabase
    .from('member_invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq('id', row.id)
    .is('accepted_at', null)
  if (acceptErr) {
    console.error(`${LOG} accept stamp failed for invitation=${row.id}: ${acceptErr.message}`)
    return NextResponse.json({ error: acceptErr.message }, { status: 500 })
  }

  console.log(`${LOG} accepted invitation=${row.id} user=${userId} org=${row.organization_id}`)
  return NextResponse.json({ ok: true, email }, { status: 200 })
}
