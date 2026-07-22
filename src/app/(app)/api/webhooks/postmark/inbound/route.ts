import { NextResponse, after, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { renderLeadChannelBounce } from '@/lib/email/templates/lead-channel-bounce'
import { renderTicketConfirmationEmail } from '@/lib/email/templates/ticket-confirmation'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { enqueueDraftJob, drainDraftJobs } from '@/lib/ai/auto-draft'
import { mintSmsOptInToken } from '@/lib/sms/opt-in'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[postmark-inbound]'

// Matches `[tk_<id>]` (case-insensitive) anywhere in the subject line.
const TICKET_TAG_RE = /\[(tk_[a-z0-9]+)\]/i

// Lead-conversation tag — same shape as TICKET_TAG_RE, scoped to the
// lead-magnet confirmation + lead public reply pipeline. Routed into
// public.lead_messages instead of ticket_messages.
const LEAD_TAG_RE   = /\[(ld_[a-z0-9]+)\]/i

// Appointment-confirmation tag — Workstream F Hotfix #6. On the lead
// channel, resolves to the appointment's linked lead (alias-safe vs.
// sender-email fallback). On the support channel, resolves to the
// appointment's linked ticket (if backfilled) or falls through to Path C
// with a backfill, so subsequent replies thread to the same ticket.
const APPT_TAG_RE   = /\[(ap_[a-z0-9]+)\]/i

// Auto-responder suppression for the Path C confirmation email. Skipping
// these avoids pinging bounces / out-of-office daemons / no-reply replies
// that would otherwise create needless inbound noise. Substring match (not
// equality) so noreply+anything@... and team-noreply@... both match.
const AUTO_RESPONDER_LOCALPARTS = ['noreply', 'no-reply', 'mailer-daemon', 'postmaster', 'bounces']
function isLikelyAutoResponder(email: string): boolean {
  const localpart = email.split('@')[0]?.toLowerCase() ?? ''
  return AUTO_RESPONDER_LOCALPARTS.some(needle => localpart.includes(needle))
}

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

// Phase 6c-inline: body composer for the system message that records an
// archived-lead auto-restore from an inbound email reply. Mirrors the
// Phase 6a magnet-resubmission archived-restore system message shape but
// without form-submission fields (inbound emails don't carry name/phone/
// appointment data — only sender, subject, and the message body itself).
function composeInboundAutoRestoreBody(args: {
  priorStatus: string
  fromEmail:   string
  subject:     string | null
}): string {
  const lines: string[] = ['Auto-restored from Archived.']
  if (args.priorStatus !== 'new') {
    lines.push(`Status reset from '${args.priorStatus}' to 'new'.`)
  }
  lines.push(`Inbound reply from ${args.fromEmail}.`)
  if (args.subject && args.subject.trim()) {
    lines.push(`Subject: ${args.subject.trim()}`)
  }
  return lines.join('\n')
}

// ── Workstream AD Stage 2 — auto-draft producer ──────────────────────────────
// Called after a customer inbound message is persisted (reply-to-existing and
// new-ticket paths). For auto-mode orgs it enqueues a draft job and kicks the
// drainer AFTER the response (via next/server after()), so the webhook never
// pays the ~3-8s Claude latency. Purely additive + best-effort: it never throws
// and never changes the webhook's ticketing result. `supabase` is the route's
// service-role admin client.
async function maybeEnqueueAutoDraft(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  ticketId: string,
  sourceMessageId: string,
): Promise<void> {
  try {
    // Gate: auto mode on AND master flag on AND a template assigned. Any miss →
    // no-op (mirrors draftTicketReply's gate; the drainer re-checks at drain
    // time too, so a race here is harmless).
    const { data: org } = await supabase
      .from('organizations')
      .select('ai_drafting_mode, feature_flags, ai_template_id')
      .eq('id', orgId)
      .maybeSingle<{ ai_drafting_mode: string | null; feature_flags: Record<string, unknown> | null; ai_template_id: string | null }>()

    const autoDraft        = org?.ai_drafting_mode === 'auto_draft'
    const aiSupportEnabled = org?.feature_flags?.ai_support_enabled === true
    if (!autoDraft || !aiSupportEnabled || !org?.ai_template_id) return

    // Staleness: if a stored draft answers an OLDER inbound, drop it now. On
    // success the drain UPSERTs a fresh draft (onConflict ticket_id) — but if the
    // drain later SKIPS (e.g. zero balance at drain time), a stored draft
    // answering a superseded message is worse than none, so remove it up front.
    const { data: existingDraft } = await supabase
      .from('ai_ticket_drafts')
      .select('source_message_id')
      .eq('ticket_id', ticketId)
      .maybeSingle<{ source_message_id: string | null }>()
    if (existingDraft && existingDraft.source_message_id !== sourceMessageId) {
      await supabase.from('ai_ticket_drafts').delete().eq('ticket_id', ticketId)
    }

    // Enqueue (idempotent per ticket via the partial-unique live-job index;
    // never throws) then kick the drainer post-response.
    await enqueueDraftJob({ orgId, ticketId, sourceMessageId, reason: 'inbound_message' })
    after(async () => {
      try {
        await drainDraftJobs(3)
      } catch (err) {
        console.error(`${LOG} [auto-draft-kick] drain failed ticket=${ticketId}:`, err)
      }
    })
  } catch (err) {
    // Defensive: the auto-draft hook must NEVER fail the webhook.
    console.error(`${LOG} [auto-draft-kick] enqueue hook failed ticket=${ticketId}:`, err)
  }
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

  // W1-1: gate on a resolvable ORG only — NOT on a non-null owner. An ownerless
  // org must still receive + route inbound mail. ownerId is no longer required
  // here: lead-channel replies thread to existing leads (owner-irrelevant), and
  // the support new-ticket path authors via the lead-inbox bot (leadInboxId ??
  // ownerId). ownerId is used nowhere else in this handler beyond created_by
  // (now bot-first) and ticket_recipients.added_by (nullable, already null-safe).
  if (!org || !orgId) {
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
    let matchedLead: { id: string; status: string; archived_at: string | null } | null = null

    const leadTagMatch = subject.match(LEAD_TAG_RE)
    if (leadTagMatch) {
      const displayId = leadTagMatch[1].toLowerCase()
      const { data } = await supabase
        .from('leads')
        .select('id, status, archived_at')
        .eq('organization_id', orgId)
        .eq('display_id', displayId)
        .is('deleted_at', null)
        .maybeSingle<{ id: string; status: string; archived_at: string | null }>()
      if (data) matchedLead = data
    }

    // Workstream F Hotfix #6: [ap_X] appointment-tag lookup.
    // Deterministic routing for appointment-confirmation replies — the
    // sender-email fallback (below) is alias-unsafe when users share an
    // inbox across multiple lead/customer rows. The [ap_X] tag points
    // directly to the appointment row, which has the authoritative lead_id.
    if (!matchedLead) {
      const apptTagMatch = subject.match(APPT_TAG_RE)
      if (apptTagMatch) {
        const apptDisplayId = apptTagMatch[1].toLowerCase()
        const { data: appt } = await supabase
          .from('appointments')
          .select('lead_id')
          .eq('organization_id', orgId)
          .eq('display_id', apptDisplayId)
          .maybeSingle<{ lead_id: string | null }>()
        if (appt?.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('id, status, archived_at')
            .eq('id', appt.lead_id)
            .is('deleted_at', null)
            .maybeSingle<{ id: string; status: string; archived_at: string | null }>()
          if (lead) {
            matchedLead = lead
            console.log(`${LOG} matched lead via [ap_X] tag appt=${apptDisplayId} lead_id=${lead.id}`)
          }
        }
      }
    }

    if (!matchedLead) {
      const { data } = await supabase
        .from('leads')
        .select('id, status, archived_at')
        .eq('organization_id', orgId)
        .ilike('email', fromEmail.replace(/[\\%_]/g, m => '\\' + m))
        .is('deleted_at', null)
        .maybeSingle<{ id: string; status: string; archived_at: string | null }>()
      if (data) matchedLead = data
    }

    if (matchedLead && matchedLead.status !== 'converted') {
      // Phase 6c-inline: archived lead replying via the lead-channel auto-
      // restores back to the active list. Single UPDATE folds the Phase 6b
      // activity bump into the restore write (one round-trip, atomic).
      // Converted has already been excluded above; converted-and-archived
      // still bounces below.
      if (matchedLead.archived_at !== null) {
        const priorStatus = matchedLead.status
        const nowIso      = new Date().toISOString()

        const { error: restoreErr } = await supabase
          .from('leads')
          .update({
            archived_at:           null,
            status:                'new',
            last_lead_activity_at: nowIso,
          })
          .eq('id', matchedLead.id)
        if (restoreErr) {
          console.error(`${LOG} lead-channel auto-restore UPDATE failed lead=${matchedLead.id}:`, restoreErr.message)
          return NextResponse.json({ error: restoreErr.message }, { status: 500 })
        }

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
          console.error(`${LOG} lead-channel auto-restore append failed lead=${matchedLead.id}:`, insErr.message)
          return NextResponse.json({ error: insErr.message }, { status: 500 })
        }

        const sysBody = composeInboundAutoRestoreBody({
          priorStatus,
          fromEmail,
          subject: subject || null,
        })
        const { error: sysErr } = await supabase.from('lead_messages').insert({
          lead_id:         matchedLead.id,
          organization_id: orgId,
          message_type:    'internal_note',
          author_kind:     'system',
          author_user_id:  null,
          body:            sysBody,
        })
        if (sysErr) {
          // Non-fatal — the restore + thread already succeeded; an audit-trail
          // miss must not flap the webhook.
          console.error(`${LOG} lead-channel auto-restore system msg failed lead=${matchedLead.id}:`, sysErr.message)
        }

        console.log(`${LOG} auto-restored archived lead lead_id=${matchedLead.id} prior_status=${priorStatus} from=${fromEmail}`)
        return NextResponse.json({ status: 'auto_restored', lead_id: matchedLead.id }, { status: 200 })
      }

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
  // turn into a ticket. Covers paths B and C — the lead-channel block
  // above has its own narrower lead-side guard.
  const verifiedSupportEmail = org.verified_support_email?.toLowerCase() ?? null
  const verifiedLeadEmail    = org.verified_lead_email?.toLowerCase() ?? null
  if (
    fromEmail === verifiedSupportEmail ||
    fromEmail === verifiedLeadEmail
  ) {
    console.warn(`${LOG} support-channel loop guard tripped — dropping from=${fromEmail} org=${orgId}`)
    return NextResponse.json({ ignored: 'loop_guard' }, { status: 200 })
  }

  // 4. Threading — try [tk_X] then [ap_X] subject tags, in that order.
  //    [tk_X] points at a ticket directly. [ap_X] points at an appointment
  //    whose ticket_id (when populated) is the stable threading destination;
  //    if the appointment has no ticket yet (pre-Workstream-G rows), the
  //    [ap_X] branch sets a backfill marker and falls through to Path C,
  //    which then writes appointments.ticket_id so subsequent replies
  //    thread here instead of duplicating tickets.
  let matchedTicket: { id: string; status: string; displayLabel: string } | null = null
  let backfillApptId: string | null = null
  let apptCustomerForFallback: string | null = null

  const tkTagMatch = subject.match(TICKET_TAG_RE)
  if (tkTagMatch) {
    const displayId = tkTagMatch[1].toLowerCase()
    const { data: ticket, error: tErr } = await supabase
      .from('tickets')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq('display_id', displayId)
      .maybeSingle<{ id: string; status: string }>()

    if (tErr) {
      console.error(`${LOG} ticket lookup failed display_id=${displayId} org=${orgId}:`, tErr.message)
      return NextResponse.json({ error: tErr.message }, { status: 500 })
    }

    if (ticket) {
      matchedTicket = { ...ticket, displayLabel: displayId }
    } else {
      console.warn(`${LOG} subject tag ${displayId} not in org ${orgId} — falling through to next lookup`)
    }
  }

  // Workstream F Hotfix #6: [ap_X] appointment-tag lookup on support channel.
  if (!matchedTicket) {
    const apptTagMatch = subject.match(APPT_TAG_RE)
    if (apptTagMatch) {
      const apptDisplayId = apptTagMatch[1].toLowerCase()
      const { data: appt } = await supabase
        .from('appointments')
        .select('id, customer_id, ticket_id')
        .eq('organization_id', orgId)
        .eq('display_id', apptDisplayId)
        .maybeSingle<{ id: string; customer_id: string | null; ticket_id: string | null }>()
      if (appt) {
        if (appt.ticket_id) {
          const { data: ticket } = await supabase
            .from('tickets')
            .select('id, status')
            .eq('id', appt.ticket_id)
            .maybeSingle<{ id: string; status: string }>()
          if (ticket) {
            matchedTicket = { ...ticket, displayLabel: apptDisplayId }
            console.log(`${LOG} matched ticket via [ap_X] tag appt=${apptDisplayId} ticket_id=${ticket.id}`)
          }
        } else {
          // First reply on a pre-G appointment. Path C creates the ticket;
          // backfillApptId triggers the UPDATE after creation. Pre-populating
          // the customer link makes Path C alias-safe (sender email may not
          // match customers.email for shared-inbox testers).
          backfillApptId = appt.id
          if (appt.customer_id) {
            apptCustomerForFallback = appt.customer_id
          }
          console.log(`${LOG} [ap_X] tag appt=${apptDisplayId} has no ticket — falling through to Path C with backfill`)
        }
      }
    }
  }

  if (matchedTicket) {
    const { data: insertedMsg, error: insErr } = await supabase.from('ticket_messages').insert({
      ticket_id:           matchedTicket.id,
      org_id:              orgId,
      sender_id:           null,
      body:                messageBody,
      type:                'public',
      external_message_id: messageId,
      inbound_email_from:  fromEmail,
    }).select('id').single<{ id: string }>()
    if (insErr) {
      console.error(`${LOG} append failed ticket=${matchedTicket.displayLabel}:`, insErr.message)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    // AD Stage 3 — activity bump + auto-reopen, folded into one UPDATE.
    // A customer reply is a customer-originated event: bump
    // last_ticket_activity_at so the tickets-grid unseen dot shows until a
    // user opens the ticket (mirrors leads.last_lead_activity_at). The
    // set_tickets_updated_at BEFORE-UPDATE trigger refreshes updated_at as a
    // side effect, so the existing updated_at-desc sort floats the ticket up.
    // When the ticket is closed we fold the auto-reopen (status → open) into
    // the same write so the team sees it back in the Active queue. Non-fatal:
    // the customer message already persisted; a badge/reopen miss must never
    // reject a real reply.
    const nowIso    = new Date().toISOString()
    const reopening = matchedTicket.status === 'closed'
    let   reopened  = false
    const { error: bumpErr } = await supabase
      .from('tickets')
      .update(
        reopening
          ? { last_ticket_activity_at: nowIso, status: 'open' }
          : { last_ticket_activity_at: nowIso },
      )
      .eq('id', matchedTicket.id)
    if (bumpErr) {
      console.error(`${LOG} activity bump${reopening ? '/auto-reopen' : ''} failed for ticket=${matchedTicket.displayLabel}:`, bumpErr.message)
    } else if (reopening) {
      reopened = true
      console.log(`${LOG} auto-reopened ticket ${matchedTicket.displayLabel} on inbound reply`)
    }

    // TODO: persist payload.Attachments to Supabase Storage and link rows
    //       (e.g. a `ticket_message_attachments` table) once that surface
    //       lands. Postmark provides each attachment as base64 `Content`
    //       with `Name`, `ContentType`, `ContentLength`.

    // Workstream AD Stage 2: auto-draft on inbound reply. Additive + best-effort
    // — gated to auto-mode orgs, never affects the append/reopen result above.
    if (insertedMsg?.id) {
      await maybeEnqueueAutoDraft(supabase, orgId, matchedTicket.id, insertedMsg.id)
    }

    console.log(`${LOG} appended message to ticket ${matchedTicket.displayLabel} (${matchedTicket.id}) from=${fromEmail}${reopened ? ' [reopened]' : ''}`)
    return NextResponse.json({ status: 'appended', ticket_id: matchedTicket.id, reopened }, { status: 200 })
  }

  // 5. No tag (or tag missed) → new customerless-or-customer-linked ticket.
  //    Match the sender against customers.email for this org; on hit, link
  //    the ticket to the customer. On miss, the ticket is opened with
  //    customer_id NULL — outbound replies still work via the
  //    ticket_messages.inbound_email_from fallback. lead_id is ALWAYS
  //    NULL on the support rail; leads and customers are separate rails
  //    (see Master Manifest Part 5) and a support-channel inbound never
  //    creates or touches a lead.
  // Customer resolution: [ap_X] appointment-tag wins when present (alias-
  // safe, points at the appointment's canonical customer), else sender-
  // email match.
  let customerId: string | null = apptCustomerForFallback
  if (customerId) {
    console.log(`${LOG} matched customer ${customerId} via [ap_X] tag for ${fromEmail}`)
  } else {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('email', fromEmail.replace(/[\\%_]/g, m => '\\' + m))
      .is('deleted_at', null)
      .maybeSingle()
    customerId = customer?.id ?? null
    if (customerId) {
      console.log(`${LOG} matched customer ${customerId} for ${fromEmail}`)
    } else {
      console.log(`${LOG} no customer match for ${fromEmail} — opening customerless ticket`)
    }
  }

  // Create the ticket. Description holds the full original body; the
  // first ticket_messages row stores the cleaned reply for the thread view.
  const newSubject = subject.trim() || `Inbound from ${fromEmail}`

  // W1-1: author the ticket as the org's lead-inbox bot — a per-org system
  // profile guaranteed by the lead-inbox trigger/backfill (FK-valid, 1-per-org)
  // — falling back to the owner. Removes this path's dependence on a non-null
  // owner so an ownerless org's inbound mail still opens tickets.
  const { data: leadInbox } = await supabase
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_org_inbox', true)
    .eq('org_inbox_kind', 'lead')
    .maybeSingle<{ id: string }>()
  const leadInboxId = leadInbox?.id ?? null

  const { data: newTicket, error: tCreateErr } = await supabase
    .from('tickets')
    .insert({
      organization_id: orgId,
      customer_id:     customerId,
      lead_id:         null,
      created_by:      leadInboxId ?? ownerId,
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

  // Workstream F Hotfix #6: backfill appointments.ticket_id when this Path C
  // run was triggered by an [ap_X] reply on a pre-G appointment. Subsequent
  // replies to that appointment will then thread to this ticket via the
  // [ap_X] lookup above instead of creating duplicate tickets. Non-fatal
  // on failure — the ticket already exists.
  if (backfillApptId) {
    const { error: backfillErr } = await supabase
      .from('appointments')
      .update({ ticket_id: newTicket.id, updated_at: new Date().toISOString() })
      .eq('id', backfillApptId)
    if (backfillErr) {
      console.error(`${LOG} failed to backfill appointment.ticket_id appt=${backfillApptId} ticket=${newTicket.id}:`, backfillErr.message)
    } else {
      console.log(`${LOG} backfilled appointment.ticket_id appt=${backfillApptId} ticket=${newTicket.id}`)
    }
  }

  const { data: initialMsg, error: msgErr } = await supabase.from('ticket_messages').insert({
    ticket_id:           newTicket.id,
    org_id:              orgId,
    sender_id:           null,
    body:                messageBody,
    type:                'public',
    external_message_id: messageId,
    inbound_email_from:  fromEmail,
  }).select('id').single<{ id: string }>()
  if (msgErr) {
    console.error(`${LOG} initial message insert failed ticket=${newTicket.id}:`, msgErr.message)
    // Ticket exists; surface as 500 so the provider retries the whole thing.
    return NextResponse.json({ error: msgErr.message }, { status: 500 })
  }

  // AD Stage 3 — a brand-new customer ticket is unseen activity: bump
  // last_ticket_activity_at so the tickets-grid dot shows until a user opens
  // it (updated_at is already fresh from the create above). Non-fatal.
  const { error: bumpErr } = await supabase
    .from('tickets')
    .update({ last_ticket_activity_at: new Date().toISOString() })
    .eq('id', newTicket.id)
  if (bumpErr) {
    console.error(`${LOG} Path C: activity bump failed ticket=${newTicket.id}:`, bumpErr.message)
  }

  // Workstream AD Stage 2: auto-draft on the new ticket's first inbound.
  // Additive + best-effort — gated to auto-mode orgs, never affects creation.
  if (initialMsg?.id) {
    await maybeEnqueueAutoDraft(supabase, orgId, newTicket.id, initialMsg.id)
  }

  // TODO: persist payload.Attachments to Supabase Storage (see above).

  // Workstream E — seed a 'to' recipient row for outbound dispatch. Future
  // ticket replies fan out from ticket_recipients first, falling back to
  // customers.email + ticket_messages.inbound_email_from for legacy rows.
  // Non-fatal — the ticket and inbound message already persisted.
  const { error: recipErr } = await supabase
    .from('ticket_recipients')
    .insert({
      ticket_id: newTicket.id,
      kind:      'to',
      email:     fromEmail,
      added_by:  ownerId,
    })
  if (recipErr) {
    console.error(`${LOG} Path C: ticket_recipients insert failed ticket=${newTicket.id}:`, recipErr.message)
  }

  // Workstream E — send a confirmation email to the sender. Skipped for
  // likely auto-responders so we don't ping bounces / no-reply daemons.
  // Non-fatal on send failure: the ticket already exists; if we 500'd here
  // Postmark would retry the entire webhook and duplicate the ticket.
  const ticketDisplayId = newTicket.display_id ?? newTicket.id
  if (!isLikelyAutoResponder(fromEmail)) {
    // SMS Stage 2a — offer "prefer text messages?" only when this ticket has a
    // customer row to attach consent to. A customerless ticket (customerId null)
    // has nowhere to record opt-in, so the link is skipped. Fail-open: a null URL
    // (mint failed, or the customer already opted in) just omits the link.
    const smsOptInUrl = customerId ? await mintSmsOptInToken('customer', customerId) : null

    const { subject: confSubject, htmlBody, textBody } = renderTicketConfirmationEmail({
      orgName:         org.name,
      ticketDisplayId,
      originalSubject: subject.trim() || null,
      smsOptInUrl,
    })

    const threadingId = `<${ticketDisplayId}@kinvox.com>`
    const replyTo     = constructInboundEmailAddress(org.inbound_email_tag ?? null)

    const sendResult = await sendOrgTransactionalEmail({
      org: {
        id:                                  org.id,
        name:                                org.name,
        verified_support_email:              org.verified_support_email,
        verified_support_email_confirmed_at: org.verified_support_email_confirmed_at,
        verified_lead_email:                 org.verified_lead_email,
        verified_lead_email_confirmed_at:    org.verified_lead_email_confirmed_at,
      },
      to:                fromEmail,
      subject:           confSubject,
      htmlBody,
      textBody,
      fromAddressSource: 'support',
      tag:               'ticket-confirmation',
      replyTo:           replyTo ?? undefined,
      // Message-ID (not References/In-Reply-To) — this is the start of the
      // thread, not a reply. Future inbound replies match by the bracketed
      // [tk_…] subject tag, but a Message-ID on the seed mail lets mail
      // clients group threads by ID too.
      headers: [
        { Name: 'Message-ID', Value: threadingId },
      ],
    })

    if (!sendResult.ok) {
      console.error(`${LOG} Path C: confirmation email send failed ticket=${newTicket.id}:`, sendResult.error)
    } else {
      console.log(`${LOG} Path C: confirmation sent ticket=${newTicket.id} to=${fromEmail} postmark_id=${sendResult.messageId}`)
    }
  } else {
    console.log(`${LOG} Path C: confirmation skipped (auto-responder sender) ticket=${newTicket.id} from=${fromEmail}`)
  }

  console.log(`${LOG} created ticket ${newTicket.display_id ?? newTicket.id} from ${fromEmail} customer=${customerId ?? 'none'}`)
  return NextResponse.json({ status: 'created', ticket_id: newTicket.id, customer_id: customerId }, { status: 201 })
}
