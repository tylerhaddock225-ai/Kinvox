// Internal-Team check. Returns true for any verified @kinvoxtech.com
// email and false otherwise (including null/undefined). Used by the
// sorting hat (src/lib/supabase/session.ts) and the HQ layout
// (src/app/(app)/(admin)/hq/layout.tsx) to grant a Team member access
// to /hq even before profiles.system_role is provisioned. Both gates
// must agree on this predicate or you get a redirect loop — keeping it
// in one place makes "what counts as Team" trivially auditable.
//
// The email comes from the JWT (auth.users.email), not user input, so
// it can't be spoofed by a tenant user.
export function isTeamEmail(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase().endsWith('@kinvoxtech.com')
}
