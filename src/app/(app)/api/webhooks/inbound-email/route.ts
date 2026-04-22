import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cleanEmailBody } from '@/lib/email-parser'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

// Matches `[tk_<id>]` (case-insensitive) anywhere in the subject line.
const TICKET_TAG_RE = /\[(tk_[a-z0-9]+)\]/i

const LOG = '[inbound-email]'

type Recipient = string | { Email?: string; email?: string; Address?: string; address?: string }

function pickEmail(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    const m = value.match(/<([^>]+)>/) ?? value.match(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)
    return (m ? m[1] : value).trim().toLowerCase() || null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = pickEmail(v as Recipient)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object') {
    const o = value as { Email?: string; email?: string; Address?: string; address?: string }
    return (o.Email ?? o.email ?? o.Address ?? o.address ?? null)?.toLowerCase() ?? null
  }
  return null
}

// `_` and `%` are LIKE wildcards in PostgREST. Email local-parts can contain `_`,
// so escape both before passing to .ilike() to avoid accidental matches.
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, m => '\\' + m)
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>
  try {
    payload = await request.json() as Record<string, unknown>
  } catch (err) {
    console.error(`${LOG} invalid JSON payload:`, err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Field shapes vary by provider (Postmark uses PascalCase, Resend / SendGrid lowercase).
  const subject  = (payload.Subject ?? payload.subject ?? '') as string
  const toAddr   = pickEmail(payload.To ?? payload.to ?? payload.OriginalRecipient ?? payload.recipient)
  const fromAddr = pickEmail(payload.From ?? payload.from ?? payload.FromFull)
  const rawBody  = (payload.TextBody ?? payload.text ?? payload.StrippedTextReply ?? payload['body-plain'] ?? '') as string
  const messageId = (payload.MessageID ?? payload.MessageId ?? payload.messageId ?? payload['Message-Id'] ?? null) as string | null

  console.log(`${LOG} received: to=${toAddr ?? '?'} from=${fromAddr ?? '?'} subject="${subject}" message_id=${messageId ?? '-'}`)

  if (!toAddr) {
    console.error(`${LOG} rejected — missing recipient address`)
    return NextResponse.json({ error: 'Missing recipient address' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // 1. Resolve the org by inbound address.
  //    Case-insensitive exact match against organizations.inbound_email_address.
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, owner_id, inbound_email_address')
    .ilike('inbound_email_address', escapeIlike(toAddr))
    .maybeSingle()

  if (orgErr) {
    console.error(`${LOG} org lookup failed for to=${toAddr}:`, orgErr.message)
    return NextResponse.json({ error: orgErr.message }, { status: 500 })
  }
  if (!org) {
    // Unknown mailbox — drop with 200 so the provider stops retrying.
    console.warn(`${LOG} unknown recipient ${toAddr} — dropping`)
    return NextResponse.json({ ignored: 'unknown recipient' }, { status: 200 })
  }

  const orgId = org.id as string
  console.log(`${LOG} resolved org ${orgId} from ${toAddr}`)

  const cleaned = cleanEmailBody(rawBody) || '(empty)'

  // 2. Threading — does the subject reference an existing ticket in this org?
  const tagMatch = subject.match(TICKET_TAG_RE)
  if (tagMatch) {
    const displayId = tagMatch[1].toLowerCase()
    const { data: ticket, error: tLookupErr } = await supabase
      .from('tickets')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .eq('display_id', displayId)
      .maybeSingle()

    if (tLookupErr) {
      console.error(`${LOG} ticket lookup failed display_id=${displayId} org=${orgId}:`, tLookupErr.message)
      return NextResponse.json({ error: tLookupErr.message }, { status: 500 })
    }

    if (ticket) {
      const { error: insErr } = await supabase.from('ticket_messages').insert({
        ticket_id:           ticket.id,
        org_id:              orgId,
        sender_id:           null,
        body:                cleaned,
        type:                'public',
        external_message_id: messageId,
      })
      if (insErr) {
        console.error(`${LOG} append failed ticket=${displayId}:`, insErr.message)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
      console.log(`${LOG} appended message to ticket ${displayId} (${ticket.id})`)
      return NextResponse.json({ status: 'appended', ticket_id: ticket.id }, { status: 200 })
    }
    console.warn(`${LOG} subject tag ${displayId} not found in org ${orgId} — falling through to new ticket`)
  }

  // 3. No matching ticket — create one. Description holds the original email body.
  const newSubject = subject.trim() || `Inbound from ${fromAddr ?? 'unknown'}`

  // tickets.created_by is NOT NULL → use the org owner as the system author.
  const createdBy = org.owner_id
  if (!createdBy) {
    console.error(`${LOG} org ${orgId} has no owner — cannot create ticket`)
    return NextResponse.json({ error: 'Org has no owner' }, { status: 500 })
  }

  const { data: newTicket, error: tErr } = await supabase
    .from('tickets')
    .insert({
      organization_id: orgId,
      created_by:      createdBy,
      subject:         newSubject,
      description:     cleaned,
      channel:         'email',
      status:          'open',
      priority:        'medium',
    })
    .select('id, display_id')
    .single()

  if (tErr || !newTicket) {
    console.error(`${LOG} ticket create failed org=${orgId}:`, tErr?.message ?? 'unknown')
    return NextResponse.json({ error: tErr?.message ?? 'Failed to create ticket' }, { status: 500 })
  }

  console.log(`${LOG} created ticket ${newTicket.display_id ?? newTicket.id} from ${fromAddr ?? '?'}`)
  return NextResponse.json({ status: 'created', ticket_id: newTicket.id }, { status: 201 })
}
