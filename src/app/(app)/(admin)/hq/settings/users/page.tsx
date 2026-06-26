import { redirect } from 'next/navigation'

// Folded into the unified HQ settings hub (J4). Kept as a redirect so any
// bookmarked / in-flight /hq/settings/users link still resolves. The user-admin
// UI now lives in the "User Administration" tab of /hq/settings, which composes
// HqUsersClient directly; users/actions.ts + HqUsersClient.tsx remain and are
// imported by the hub.
export default function HqUsersRedirect() {
  redirect('/hq/settings')
}
