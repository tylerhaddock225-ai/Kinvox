'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type State = { status: 'success' } | { status: 'error'; error: string } | null

// HQ-scoped reply. Relies on the RLS policy added in
// 20260419221000_platform_settings_and_hq_mutations.sql which lets
// is_admin_hq() users INSERT into ticket_messages across orgs. The
// merchant's own org still owns the row (org_id = ticket.organization_id)
// so merchant-side RLS continues to resolve thread membership correctly.
export async function sendHQTicketMessage(_prev: State, formData: FormData): Promise<State> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return { status: 'error', error: 'Not authorized' }

  const ticket_id = formData.get('ticket_id') as string
  const body      = formData.get('body')      as string
  const type      = formData.get('type')      as string

  if (!ticket_id) return { status: 'error', error: 'Ticket is required' }
  if (!body?.trim()) return { status: 'error', error: 'Message cannot be empty' }
  if (type !== 'public' && type !== 'internal') {
    return { status: 'error', error: 'Invalid message type' }
  }

  // HQ SELECT policy is_admin_hq() covers the lookup across orgs.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, organization_id')
    .eq('id', ticket_id)
    .single()

  if (!ticket) return { status: 'error', error: 'Ticket not found' }

  const { error } = await supabase.from('ticket_messages').insert({
    ticket_id,
    org_id:    ticket.organization_id,
    sender_id: user.id,
    body:      body.trim(),
    type,
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/admin-hq/tickets/${ticket_id}`)
  revalidatePath('/admin-hq/tickets')
  return { status: 'success' }
}

// Thin wrapper around updateTicketStatus for inline Close buttons in the
// grid. Kept in the admin-hq action set so the merchant action file doesn't
// have to know about HQ flows.
export async function closeHQTicket(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return

  const ticket_id = formData.get('ticket_id') as string
  if (!ticket_id) return

  // RLS ("HQ admins can update tickets") lets this through across orgs.
  await supabase
    .from('tickets')
    .update({ status: 'closed' })
    .eq('id', ticket_id)

  revalidatePath('/admin-hq/tickets')
  revalidatePath(`/admin-hq/tickets/${ticket_id}`)
}

const HQ_CATEGORIES = ['bug', 'billing', 'feature_request', 'question'] as const
type HQCategory = typeof HQ_CATEGORIES[number]

// Inline HQ category edit for the Admin HQ tickets grid. Gated on system_role;
// only valid on platform_support tickets (hq_category is null on regular
// merchant tickets per the CHECK + null-default). RLS "HQ admins can update
// tickets" covers the cross-org update.
export async function updateHQTicketCategory(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('system_role')
    .eq('id', user.id)
    .single()

  if (!profile?.system_role) return

  const ticket_id = formData.get('ticket_id')  as string
  const category  = formData.get('hq_category') as string
  if (!ticket_id) return
  if (!HQ_CATEGORIES.includes(category as HQCategory)) return

  await supabase
    .from('tickets')
    .update({ hq_category: category as HQCategory })
    .eq('id', ticket_id)
    .eq('is_platform_support', true)

  revalidatePath('/admin-hq/tickets')
  revalidatePath(`/admin-hq/tickets/${ticket_id}`)
}
