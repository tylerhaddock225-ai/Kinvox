import { redirect } from 'next/navigation'
import type { HqPermissions } from '@/lib/permissions'

// Row shape consumed by HqRolesTable + the /hq/settings hub. It stays in this
// module (the component imports it from './page') even though the page itself is
// now just a redirect: the Roles UI was folded into the "User Administration"
// tab of /hq/settings (J4). roles/actions.ts + HqRolesTable + CreateHqRoleForm
// remain and are imported by the hub.
export type HqRoleRow = {
  id:             string
  name:           string
  permissions:    HqPermissions
  is_system_role: boolean
  member_count:   number
}

// Bookmark / in-flight-link safety net → the hub.
export default function HqRolesRedirect() {
  redirect('/hq/settings')
}
