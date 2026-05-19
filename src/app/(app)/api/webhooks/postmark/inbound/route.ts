import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { renderLeadChannelBounce } from '@/lib/email/templates/lead-channel-bounce'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'

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
  OriginalRecipient?: string
  Subject?:           string
  MessageID?:         string
  MailboxHash?:       string
  TextBody?:          string
  StrippedTextReply?: string
  Attachments?:       unknown[]
}

// Inbound Domain Forwarding (custom MX → Postmark) does NOT populate
// MailboxHash — Postmark only fills it for plus-addressed mail on the
// default `*@inbound.postmarkapp.com` mailbox. For custom-domain inbound
// the full To address shows up in OriginalRecipient (and the same value
// in ToFull[0].Email), and the routing tag is the localpart of that
// address. resolveInboundTag tries MailboxHash first (legacy plus-
// addressed path), then OriginalRecipient, then ToFull[0].Email.
type TagSource = 'mailbox_hash' | 'original_recipient' | 'to_full'
function resolveInboundTag(payload: InboundPayload): { tag: string; source: TagSource } | null {
  const fromHash = (payload.MailboxHash ?? '').trim()
  if (fromHash) return { tag: fromHash.toLowerCase(), source: 'mailbox_hash' }

  const fromOriginal = (payload.OriginalRecipient ?? '').trim()
  if (fromOriginal) {
    const local = fromOriginal.split('@')[0]?.trim() ?? ''
    if (local) return { tag: local.toLowerCase(), source: 'original_recipient' }
  }

  const fromToFull = (payload.ToFull?.[0]?.Email ?? '').trim()
  if (fromToFull) {
    const local = fromToFull.split('@')[0]?.trim() ?? ''
    if (local) return { tag: local.toLowerCase(), source: 'to_full' }
  }

  return null
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
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

  // 3. Resolve the org by per-tenant tag. Prefer Postmark's MailboxHash
  //    field (legacy plus-addressed mailbox), fall back to the localpart
  //    of OriginalRecipient / ToFull[0].Email for custom-domain inbound
  //    (Postmark leaves MailboxHash empty under Inbound Domain
  //    Forwarding). Match either channel-tag column (support or lead);
  //    downstream subject-tag dispatch handles routing to the right
  //    surface once the org is known.
  const resolved = resolveInboundTag(payload)
  // Tags are minted from a strict alphabet (slug + base32-ish hash). Reject
  // anything outside it before letting the value touch a PostgREST .or() filter.
  if (!resolved || !/^[a-z0-9-]+$/.test(resolved.tag)) {
    console.warn(`${LOG} unknown recipient — could not resolve tag from payload (MailboxHash, OriginalRecipient, ToFull all empty/malformed)`)
    return NextResponse.json({ ignored: 'unknown recipient', tag: resolved?.tag ?? null }, { status: 200 })
  }
  const tag = resolved.tag
  console.log(`${LOG} tag=${tag} source=${resolved.source}`)

  const { data: org } = await supabase
    .from('organizations')
    .select(`
      id, owner_id, name,
      inbound_email_tag, inbound_lead_email_tag,
      verified_support_email, verified_support_email_confirmed_at,
      verified_lead_email, verified_lead_email_confirmed_at
    `)
    .or(`inbound_email_tag.eq.${tag},inbound_lead_email_tag.eq.${tag}`)
    .maybeSingle()

  const orgId   = org?.id ?? null
  const ownerId = org?.owner_id ?? null

  if (!org || !orgId || !ownerId) {
    console.warn(`${LOG} unknown recipient — no resolvable org for tag=${tag} source=${resolved.source}`)
    return NextResponse.json({ ignored: 'unknown recipient', tag }, { status: 200 })
  }

  // Channel detection: which tag column matched? Drives the lead-vs-support
  // routing split below — lead-channel inbound is private infrastructure
  // (only ever exposed as Reply-To on lead-magnet confirmation mails) and
  // must NOT fall through to the "open a new ticket" support fallback.
  const channel: 'lead' | 'support' =
    org.inbound_lead_email_tag === tag ? 'lead' : 'support'
  console.log(`${LOG} resolved org=${orgId} channel=${channel}`)

  // Postmark already strips the quoted reply trail when it can. Prefer that
  // for follow-ups; fall back to the full text body for fresh threads.
  const messageBody = (stripped || textBody || '').trim() || '(empty)'

  // ── Lead channel ───────────────────────────────────────────────────────
  // Match by [ld_<displayId>] subject tag FIRST (deterministic, survives
  // Gmail plus-alias collapsing), fall back to sender-email exact match.
  // On miss OR on a converted lead, bounce the sender to the org's verified
  // support email — but only if support is itself verified, otherwise drop
  // silently to avoid steering customers at a dead end. Lead-channel
  // inbound NEVER falls through to the new-lead + new-ticket support path.
  if (channel === 'lead') {
    let matchedLead: { id: string; status: string } | null = null

    const leadTagMatch = subject.match(LEAD_TAG_RE)
    if (leadTagMatch) {
      const displayId = leadTagMatch[1].toLowerCase()
      const { data } = await supabase
        .from('leads')
        .select('id, status')
        .eq('organization_id', orgId)
        .eq('display_id', displayId)
        .is('deleted_at', null)
        .is('archived_at', null)
        .maybeSingle<{ id: string; status: string }>()
      if (data) matchedLead = data
    }

    if (!matchedLead) {
      const { data } = await supabase
        .from('leads')
        .select('id, status')
        .eq('organization_id', orgId)
        .ilike('email', fromEmail.replace(/[\\%_]/g, m => '\\' + m))
        .is('deleted_at', null)
        .is('archived_at', null)
        .maybeSingle<{ id: string; status: string }>()
      if (data) matchedLead = data
    }

    if (matchedLead && matchedLead.status !== 'converted') {
      const { error: insErr } = await supabase.from('lead_messages').insert({
        lead_id:             matchedLead.id,
        organization_id:     orgId,
        message_type:        'public_reply',
        author_kind:         'lead',
        author_user_id:      null,
        body:                messageBody,
        postmark_message_id: messageId,
        inbound_email_from:  fromEmail,
      })
      if (insErr) {
        console.error(`${LOG} lead-channel append failed lead=${matchedLead.id}:`, insErr.message)
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
      // Phase 6b: inbound reply from the lead is the canonical lead-
      // originated event. Bump last_lead_activity_at so the activity dot
      // appears on the leads list until a user opens the lead.
      // Non-fatal — a badge timestamp must never reject a real reply.
      const { error: bumpErr } = await supabase
        .from('leads')
        .update({ last_lead_activity_at: new Date().toISOString() })
        .eq('id', matchedLead.id)
      if (bumpErr) {
        console.error(`${LOG} lead-channel activity bump failed lead=${matchedLead.id}:`, bumpErr.message)
      }
      console.log(`${LOG} appended to lead_messages lead_id=${matchedLead.id} status=${matchedLead.status} from=${fromEmail}`)
      return NextResponse.json({ status: 'appended_lead', lead_id: matchedLead.id }, { status: 200 })
    }

    // Loop guard: never auto-reply to our own verified lead-notifications
    // mailbox — if a misconfigured forwarding chain points it back at us
    // we'd ping-pong indefinitely otherwise.
    if (org.verified_lead_email && fromEmail === org.verified_lead_email.toLowerCase()) {
      console.warn(`${LOG} lead-channel inbound from own verified_lead_email — dropping (loop guard) org=${orgId}`)
      return NextResponse.json({ ignored: 'loop_guard' }, { status: 200 })
    }

    // No verified support email → silent drop. This is the business-model
    // affordance: an org that's bought lead-magnet but not support gets the
    // inbound rejected silently rather than steered at an address that
    // doesn't exist on their side.
    if (!org.verified_support_email || !org.verified_support_email_confirmed_at) {
      console.warn(`${LOG} lead-channel inbound dropped — no verified support email org=${orgId} from=${fromEmail}`)
      return NextResponse.json({ ignored: 'no_support_email' }, { status: 200 })
    }

    const reason = matchedLead ? 'converted_lead' : 'unknown_sender'
    // Prefer the constructed inbound forwarding address (support-<tag>@<inboundDomain>)
    // so visitor replies route into the conversation panel via the same webhook path
    // as the support channel. Falls back to the raw verified mailbox only when
    // construction returns null (missing tag or unset POSTMARK_INBOUND_DOMAIN).
    const bounceSupportAddress =
      constructInboundEmailAddress(org.inbound_email_tag) ?? org.verified_support_email
    const tpl = renderLeadChannelBounce({
      orgName:      org.name,
      supportEmail: bounceSupportAddress,
    })
    const result = await sendOrgTransactionalEmail({
      org,
      to:                fromEmail,
      subject:           tpl.subject,
      htmlBody:          tpl.htmlBody,
      textBody:          tpl.textBody,
      fromAddressSource: 'lead',
      tag:               'lead-channel-bounce',
    })
    console.log(`${LOG} lead-channel bounce sent reason=${reason} org=${orgId} to=${fromEmail} ok=${result.ok}`)
    return NextResponse.json({ ignored: 'bounced_to_support', reason }, { status: 200 })
  }
  // ── End lead channel ───────────────────────────────────────────────────

  // Support-channel loop guard — drop if the sender is one of our own
  // verified mailboxes (support OR lead). Symmetric / cross-channel
  // defensive: a misconfigured forwarding chain that pings our own
  // support-channel inbound back at us would otherwise loop indefinitely,
  // and a stray reply from the lead-notifications mailbox should never
  // turn into a ticket. Covers paths 4a, B, and C — the lead-channel
  // block above has its own narrower lead-side guard.
  const verifiedSupportEmail = org.verified_support_email?.toLowerCase() ?? null
  const verifiedLeadEmail    = org.verified_lead_email?.toLowerCase() ?? null
  if (
    fromEmail === verifiedSupportEmail ||
    fromEmail === verifiedLeadEmail
  ) {
    console.warn(`${LOG} support-channel loop guard tripped — dropping from=${fromEmail} org=${orgId}`)
    return NextResponse.json({ ignored: 'loop_guard' }, { status: 200 })
  }

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
      .is('archived_at', null)
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
      // Phase 6b: same activity-bump as the lead-channel path — non-fatal,
      // we don't fail the webhook over a badge timestamp.
      const { error: bumpErr } = await supabase
        .from('leads')
        .update({ last_lead_activity_at: new Date().toISOString() })
        .eq('id', lead.id)
      if (bumpErr) {
        console.error(`${LOG} support-channel activity bump failed lead=${lead.id}:`, bumpErr.message)
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
        inbound_email_from:  fromEmail,
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

  // 5. No tag (or tag missed) → new customerless-or-customer-linked ticket.
  //    Match the sender against customers.email for this org; on hit, link
  //    the ticket to the customer. On miss, the ticket is opened with
  //    customer_id NULL — outbound replies still work via the
  //    ticket_messages.inbound_email_from fallback. lead_id is ALWAYS
  //    NULL on the support rail; leads and customers are separate rails
  //    (see Master Manifest Part 5) and a support-channel inbound never
  //    creates or touches a lead.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('email', fromEmail.replace(/[\\%_]/g, m => '\\' + m))
    .is('deleted_at', null)
    .maybeSingle()

  const customerId = customer?.id ?? null
  if (customerId) {
    console.log(`${LOG} matched customer ${customerId} for ${fromEmail}`)
  } else {
    console.log(`${LOG} no customer match for ${fromEmail} — opening customerless ticket`)
  }

  // Create the ticket. Description holds the full original body; the
  // first ticket_messages row stores the cleaned reply for the thread view.
  const newSubject = subject.trim() || `Inbound from ${fromEmail}`
  const { data: newTicket, error: tCreateErr } = await supabase
    .from('tickets')
    .insert({
      organization_id: orgId,
      customer_id:     customerId,
      lead_id:         null,
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
    inbound_email_from:  fromEmail,
  })
  if (msgErr) {
    console.error(`${LOG} initial message insert failed ticket=${newTicket.id}:`, msgErr.message)
    // Ticket exists; surface as 500 so the provider retries the whole thing.
    return NextResponse.json({ error: msgErr.message }, { status: 500 })
  }

  // TODO: persist payload.Attachments to Supabase Storage (see above).

  console.log(`${LOG} created ticket ${newTicket.display_id ?? newTicket.id} from ${fromEmail} customer=${customerId ?? 'none'}`)
  return NextResponse.json({ status: 'created', ticket_id: newTicket.id, customer_id: customerId }, { status: 201 })
}
