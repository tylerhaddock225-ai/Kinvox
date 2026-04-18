export const PERMISSION_KEYS = [
  { key: 'view_leads',        label: 'View Leads' },
  { key: 'edit_leads',        label: 'Edit Leads' },
  { key: 'view_tickets',      label: 'View Tickets' },
  { key: 'edit_tickets',      label: 'Edit Tickets' },
  { key: 'view_appointments', label: 'View Appointments' },
  { key: 'manage_team',       label: 'Manage Team' },
] as const

export type PermissionKey = typeof PERMISSION_KEYS[number]['key']
export type Permissions = Record<PermissionKey, boolean>

export const DEFAULT_PERMISSIONS: Permissions = {
  view_leads:        true,
  edit_leads:        true,
  view_tickets:      true,
  edit_tickets:      true,
  view_appointments: true,
  manage_team:       false,
}
