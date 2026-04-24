// Ad-hoc: report the sorting-hat-relevant fields for a user by email.
// Usage: node --env-file=.env.local scripts/inspect-user.mjs <email>

import { createClient } from '@supabase/supabase-js'

const email = process.argv[2]?.toLowerCase()
if (!email) {
  console.error('usage: node --env-file=.env.local scripts/inspect-user.mjs <email>')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!url.includes('ntwimeqxyyvjyrisqofl')) {
  console.error(`refusing to run: URL ${url} is not the sandbox project`)
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// auth.users is in the auth schema — the simplest path is listUsers.
const { data: usersPage, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 200 })
if (usersErr) { console.error('listUsers failed:', usersErr.message); process.exit(1) }

const user = usersPage.users.find(u => (u.email ?? '').toLowerCase() === email)
if (!user) {
  console.log(`no auth.users row for ${email}`)
  process.exit(0)
}
console.log(`auth.users.id         : ${user.id}`)
console.log(`auth.users.email      : ${user.email}`)
console.log(`invited_to_org (meta) : ${(user.user_metadata ?? {}).invited_to_org ?? '(none)'}`)
console.log(`last_sign_in_at       : ${user.last_sign_in_at ?? '(never)'}`)

const { data: profile, error: profileErr } = await admin
  .from('profiles')
  .select('id, organization_id, system_role')
  .eq('id', user.id)
  .maybeSingle()
if (profileErr) { console.error('profile read failed:', profileErr.message); process.exit(1) }
if (!profile) {
  console.log('profiles row         : MISSING')
  console.log('→ sorting hat will route to /pending-invite (no org, no invite, no platform role).')
  process.exit(0)
}
console.log(`profiles.organization_id : ${profile.organization_id ?? '(null)'}`)
console.log(`profiles.system_role     : ${profile.system_role ?? '(null)'}`)

let orgSlug = null
if (profile.organization_id) {
  const { data: org } = await admin
    .from('organizations')
    .select('slug, name, deleted_at')
    .eq('id', profile.organization_id)
    .maybeSingle()
  orgSlug = org?.slug ?? null
  console.log(`organizations.slug       : ${org?.slug ?? '(null)'}`)
  console.log(`organizations.name       : ${org?.name ?? '(null)'}`)
  console.log(`organizations.deleted_at : ${org?.deleted_at ?? '(live)'}`)
}

const isPlatform = typeof profile.system_role === 'string' && profile.system_role.startsWith('platform_')
const hasOrg     = Boolean(profile.organization_id && orgSlug)
const hasInvite  = Boolean((user.user_metadata ?? {}).invited_to_org)
let destination
if (isPlatform)     destination = '/admin-hq'
else if (hasOrg)    destination = `/${orgSlug}`
else if (hasInvite) destination = '/onboarding'
else                destination = '/pending-invite'

console.log('')
console.log(`sorting-hat destination : ${destination}`)
