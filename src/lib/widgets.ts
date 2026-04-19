import type { PermissionKey } from '@/lib/permissions'

export type WidgetDef = {
  id: string
  label: string
  requiresPerm: PermissionKey | null
}

export const WIDGET_DEFS: WidgetDef[] = [
  { id: 'total_leads',         label: 'Total Leads',              requiresPerm: 'view_leads' },
  { id: 'converted_leads',     label: 'Converted Leads',          requiresPerm: 'view_leads' },
  { id: 'conversion_rate',     label: 'Conversion Rate',          requiresPerm: 'view_leads' },
  { id: 'open_tickets',        label: 'Open Tickets',             requiresPerm: 'view_tickets' },
  { id: 'tickets_closed_week', label: 'Tickets Closed This Week', requiresPerm: 'view_tickets' },
  { id: 'avg_resolution_time', label: 'Avg Resolution Time',      requiresPerm: 'view_tickets' },
  { id: 'appointments',        label: 'Appointments',             requiresPerm: null },
]
