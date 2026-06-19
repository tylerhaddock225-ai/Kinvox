'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId, revalidateOrgPath } from '@/lib/impersonation'

export type ActionState = { status: 'success' } | { status: 'error'; error: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function addTicketRecipient(
  ticketId: string,
  kind:     'to' | 'cc',
  target:   { mode: 'email'; email: string } | { mode: 'user'; userId: string },
): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  if (kind !== 'to' && kind !== 'cc') {
    return { status: 'error', error: 'Invalid kind' }
  }

  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id, organization_id')
    .eq('id', ticketId)
    .maybeSingle<{ id: string; organization_id: string }>()
  if (ticketErr || !ticket) return { status: 'error', error: 'Ticket not found' }

  let insertPayload:
    | { ticket_id: string; kind: 'to' | 'cc'; added_by: string; email: string; user_id: null }
    | { ticket_id: string; kind: 'to' | 'cc'; added_by: string; user_id: string; email: null }

  if (target.mode === 'email') {
    const normalizedEmail = target.email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalizedEmail)) {
      return { status: 'error', error: 'Invalid email address' }
    }
    insertPayload = {
      ticket_id: ticketId,
      kind,
      added_by:  user.id,
      email:     normalizedEmail,
      user_id:   null,
    }
  } else {
    const userId = target.userId.trim()
    if (!userId) return { status: 'error', error: 'Invalid user' }
    insertPayload = {
      ticket_id: ticketId,
      kind,
      added_by:  user.id,
      user_id:   userId,
      email:     null,
    }
  }

  const { error } = await supabase.from('ticket_recipients').insert(insertPayload)
  if (error) {
    if (error.code === '23505') return { status: 'error', error: 'This recipient is already on the ticket' }
    if (error.code === '23514') return { status: 'error', error: 'Invalid recipient configuration' }
    return { status: 'error', error: error.message }
  }

  await revalidateOrgPath(supabase, ticket.organization_id, `/tickets/${ticketId}`)
  revalidatePath(`/hq/tickets/${ticketId}`, 'page')
  return { status: 'success' }
}

export async function removeTicketRecipient(recipientId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const { data: recipient, error: recipientErr } = await supabase
    .from('ticket_recipients')
    .select('id, ticket_id')
    .eq('id', recipientId)
    .maybeSingle<{ id: string; ticket_id: string }>()
  if (recipientErr || !recipient) return { status: 'error', error: 'Recipient not found' }

  const { data: ticket, error: ticketErr } = await supabase
    .from('tickets')
    .select('id, organization_id')
    .eq('id', recipient.ticket_id)
    .maybeSingle<{ id: string; organization_id: string }>()
  if (ticketErr || !ticket) return { status: 'error', error: 'Ticket not found' }

  const { error } = await supabase
    .from('ticket_recipients')
    .delete()
    .eq('id', recipientId)
  if (error) return { status: 'error', error: error.message }

  await revalidateOrgPath(supabase, ticket.organization_id, `/tickets/${ticket.id}`)
  revalidatePath(`/hq/tickets/${ticket.id}`, 'page')
  return { status: 'success' }
}
