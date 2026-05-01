import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[postmark-inbound]'

// Matches `[tk_<id>]` (case-insensitive) anywhere in the subject line.
const TICKET_TAG_RE = /\[(tk_[a-z0-9]+)\]/i

// Lead-conversation tag — same shape as TICKET_TAG_RE, scoped to the
// lead-magnet confirmation + lead public reply pipeline. Routed into
// public.lead_messages instead of ticket_messages.
const LEAD_TAG_RE   = /\[(ld_[a-z0-9]+)\]/i

// Postmark inbound payload (subset we use). Full shape lives in
// node_modules/postmark/dist/client/models/webhooks/payload/InboundWebhook.d.ts
type InboundRecipient = { Email: string; Name: string; MailboxHash: string }
type InboundPayload = {
  From:               string
  FromName?:          string
  FromFull?:          InboundRecipient
  ToFull?:            InboundRecipient[]
  Subject?:           string
  MessageID?:         string
  TextBody?:          string
  StrippedTextReply?: string
  Attachments?:       unknown[]
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function nameFromEmail(email: string): string {
  return email.split('@')[0]?.replace(/[._+-]+/g, ' ').trim() || 'Unknown'
}

function splitName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: 'Unknown', last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export async function POST(request: NextRequest) {
  // 1. Shared-secret query-param guard. Postmark appends `?token=...` to the
  //    inbound webhook URL; we compare it against POSTMARK_INBOUND_SECRET.
  const expected = process.env.POSTMARK_INBOUND_SECRET
  if (!expected) {
    console.error(`${LOG} POSTMARK_INBOUND_SECRET is not set — refusing to process inbound mail`)
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  const provided = request.nextUrl.searchParams.get('token') ?? ''
  if (!safeEqual(provided, expected)) {
    console.warn(`${LOG} unauthorized request — bad or missing token query param`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse payload.
  let payload: InboundPayload
  try {
    payload = await request.json() as InboundPayload
  } catch (err) {
    console.error(`${LOG} invalid JSON payload:`, err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject     = payload.Subject ?? ''
  const fromEmail   = payload.FromFull?.Email?.toLowerCase() ?? payload.From?.toLowerCase() ?? null
  const fromName    = payload.FromFull?.Name || payload.FromName || (fromEmail ? nameFromEmail(fromEmail) : 'Unknown')
  const messageId   = payload.MessageID ?? null
  const textBody    = payload.TextBody ?? ''
  const stripped    = payload.StrippedTextReply ?? ''
  const recipients  = payload.ToFull ?? []

  if (recipients.length === 0) {
    console.error(`${LOG} payload missing ToFull recipients`)
    return NextResponse.json({ error: 'Missing recipient' }, { status: 400 })
  }
  if (!fromEmail) {
    console.error(`${LOG} payload missing From address`)
    return NextResponse.json({ error: 'Missing sender' }, { status: 400 })
  }

  console.log(`${LOG} received from=${fromEmail} subject="${subject}" recipients=${recipients.length} message_id=${messageId ?? '-'}`)

  const supabase = createAdminClient()

  // 3. Resolve the org by trying each ToFull address against
  //    organizations.inbound_email_address (case-insensitive).
  let orgId:   string | null = null
  let ownerId: string | null = null
  for (const r of recipients) {
    const addr = r.Email?.toLowerCase()
    if (!addr) continue
    const { data: org } = await supabase
      .from('organizations')
      .select('id, owner_id')
      .ilike('inbound_email_address', addr.replace(/[\\%_]/g, m => '\\' + m))
      .maybeSingle()
    if (org) {
      orgId   = org.id
      ownerId = org.owner_id
      break
    }
  }

  if (!orgId || !ownerId) {
    console.warn(`${LOG} unknown recipient(s) — dropping. tried=${recipients.map(r => r.Email).join(',')}`)
    return NextResponse.json({ ignored: 'unknown recipient' }, { status: 200 })
  }

  console.log(`${LOG} resolved org=${orgId}`)

  // Postmark already strips the quoted reply trail when it can. Prefer that
  // for follow-ups; fall back to the full text body for fresh threads.
  const messageBody = (stripped || textBody || '').trim() || '(empty)'

  // 4a. Lead-conversation routing — does the subject reference an existing
  //     lead in this org via [ld_<display_id>]? Lead-magnet confirmations
  //     and lead public replies prepend this tag exactly like Tickets does
  //     with [tk_<display_id>]. Lead-tag check runs BEFORE the ticket-tag
  //     check so a lead-tagged thread routes to lead_messages even if the
  //     visitor's reply somehow also contains a tk_ token in the body.
  const leadTagMatch = subject.match(LEAD_TAG_RE)
  if (leadTagMatch) {
    const leadDisplayId = leadTagMatch[1].toLowerCase()
    const { data: lead, error: lErr } = await supabase
      .from('leads')
      .select('id, organization_id')
      .eq('organization_id', orgId)
      .eq('display_id', leadDisplayId)
      .is('deleted_at', null)
      .maybeSingle()

    if (lErr) {
      console.error(`${LOG} lead lookup failed display_id=${leadDisplayId} org=${orgId}:`, lErr.message)
      return NextResponse.json({ error: lErr.message }, { status: 500 })
    }

    if (lead) {
      const { error: insErr } = await supabase.from('lead_messages').insert({
        lead_id:             lead.id,
        organization_id:     orgId,
        message_type:        'public_reply',
        author_kind:         'lead',
        body:                messageBody,
        postmark_message_id: messageId,
        inbound_email_from:  fromEmail,
      })
      if (insErr) {
        console.error(`${LOG} append failed lead=${leadDisplayId}:`, insErr.message)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
      console.log(`${LOG} routed to lead lead_id=${lead.id} org_id=${orgId} message_id=${messageId ?? '-'}`)
      return NextResponse.json({ status: 'appended_lead', lead_id: lead.id }, { status: 200 })
    }

    // Tag was lead-shaped but didn't match a lead in this org. Mirror the
    // ticket-tag fall-through: log + continue to the no-tag path so the
    // message still becomes a ticket and isn't dropped silently.
    console.warn(`${LOG} lead-tag matched no lead id=${leadDisplayId} org=${orgId} — falling through`)
  }

  // 4b. Threading — does the subject reference an existing ticket in this org?
  const tagMatch = subject.match(TICKET_TAG_RE)
  if (tagMatch) {
    const displayId = tagMatch[1].toLowerCase()
    const { data: ticket, error: tErr } = await supabase
      .from('tickets')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq('display_id', displayId)
      .maybeSingle()

    if (tErr) {
      console.error(`${LOG} ticket lookup failed display_id=${displayId} org=${orgId}:`, tErr.message)
      return NextResponse.json({ error: tErr.message }, { status: 500 })
    }

    if (ticket) {
      const { error: insErr } = await supabase.from('ticket_messages').insert({
        ticket_id:           ticket.id,
        org_id:              orgId,
        sender_id:           null,
        body:                messageBody,
        type:                'public',
        external_message_id: messageId,
      })
      if (insErr) {
        console.error(`${LOG} append failed ticket=${displayId}:`, insErr.message)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }

      // Auto-reopen: a customer reply on a closed ticket bounces it back to
      // the Active queue so the team sees it again.
      let reopened = false
      if (ticket.status === 'closed') {
        const { error: reopenErr } = await supabase
          .from('tickets')
          .update({ status: 'open' })
          .eq('id', ticket.id)
        if (reopenErr) {
          console.error(`${LOG} auto-reopen failed for ticket=${displayId}:`, reopenErr.message)
        } else {
          reopened = true
          console.log(`${LOG} auto-reopened ticket ${displayId} on inbound reply`)
        }
      }

      // TODO: persist payload.Attachments to Supabase Storage and link rows
      //       (e.g. a `ticket_message_attachments` table) once that surface
      //       lands. Postmark provides each attachment as base64 `Content`
      //       with `Name`, `ContentType`, `ContentLength`.

      console.log(`${LOG} appended message to ticket ${displayId} (${ticket.id}) from=${fromEmail}${reopened ? ' [reopened]' : ''}`)
      return NextResponse.json({ status: 'appended', ticket_id: ticket.id, reopened }, { status: 200 })
    }

    console.warn(`${LOG} subject tag ${displayId} not in org ${orgId} — falling through to new ticket`)
  }

  // 5. No tag (or tag missed) → new lead-or-update + new ticket.
  //    Find an existing lead by email within this org, or create one from FromFull.
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('email', fromEmail.replace(/[\\%_]/g, m => '\\' + m))
    .is('deleted_at', null)
    .maybeSingle()

  let leadId: string
  if (existingLead) {
    leadId = existingLead.id
    console.log(`${LOG} matched existing lead ${leadId} for ${fromEmail}`)
  } else {
    const { first, last } = splitName(fromName)
    const { data: newLead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        organization_id: orgId,
        first_name:      first,
        last_name:       last,
        email:           fromEmail,
        source:          'other',
        status:          'new',
      })
      .select('id')
      .single()

    if (leadErr || !newLead) {
      console.error(`${LOG} lead create failed for ${fromEmail}:`, leadErr?.message ?? 'unknown')
      return NextResponse.json({ error: leadErr?.message ?? 'Failed to create lead' }, { status: 500 })
    }
    leadId = newLead.id
    console.log(`${LOG} created lead ${leadId} for ${fromEmail}`)
  }

  // Create the ticket. Description holds the full original body; the
  // first ticket_messages row stores the cleaned reply for the thread view.
  const newSubject = subject.trim() || `Inbound from ${fromEmail}`
  const { data: newTicket, error: tCreateErr } = await supabase
    .from('tickets')
    .insert({
      organization_id: orgId,
      lead_id:         leadId,
      created_by:      ownerId,
      subject:         newSubject,
      description:     (textBody || stripped || '').trim() || '(empty)',
      channel:         'email',
      status:          'open',
      priority:        'medium',
    })
    .select('id, display_id')
    .single()

  if (tCreateErr || !newTicket) {
    console.error(`${LOG} ticket create failed org=${orgId}:`, tCreateErr?.message ?? 'unknown')
    return NextResponse.json({ error: tCreateErr?.message ?? 'Failed to create ticket' }, { status: 500 })
  }

  const { error: msgErr } = await supabase.from('ticket_messages').insert({
    ticket_id:           newTicket.id,
    org_id:              orgId,
    sender_id:           null,
    body:                messageBody,
    type:                'public',
    external_message_id: messageId,
  })
  if (msgErr) {
    console.error(`${LOG} initial message insert failed ticket=${newTicket.id}:`, msgErr.message)
    // Ticket exists; surface as 500 so the provider retries the whole thing.
    return NextResponse.json({ error: msgErr.message }, { status: 500 })
  }

  // TODO: persist payload.Attachments to Supabase Storage (see above).

  console.log(`${LOG} created ticket ${newTicket.display_id ?? newTicket.id} from ${fromEmail} lead=${leadId}`)
  return NextResponse.json({ status: 'created', ticket_id: newTicket.id, lead_id: leadId }, { status: 201 })
}
