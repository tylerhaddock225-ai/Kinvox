// POST /api/webhooks/twilio/inbound
//
// Inbound SMS (Twilio-class) for BOTH rails. THREAD-ONLY: a text can never create
// a lead or a ticket — it only routes into an EXISTING conversation, first by
// bracketed tag ([tk_X]/[ld_X] in the body), else by phone match against an
// OPTED-IN customer/lead. Unmatched inbound is acknowledged (200) and dropped.
//
// On a match the message is appended to the conversation AND echoed into the
// person's EMAIL thread (their own words — the inbox stays the source of truth).
// The route itself NEVER sends SMS; the echo is email-only.
//
// Auth: Twilio signs each request with X-Twilio-Signature (HMAC-SHA1 over the
// exact configured URL + sorted POST params). We rebuild that URL from the
// x-forwarded-* headers (see below) and verify with the SDK's validateRequest.
//
// Runtime: nodejs (crypto + the Twilio SDK + service-role admin client). The
// raw body is read via request.text() BEFORE any parsing, matching the Stripe
// route — the signature is computed over the decoded params, which we parse from
// that raw body. Route handlers don't inherit (app)/layout.tsx, so this stays
// unauthenticated as Twilio expects; the signature is the shared secret.

import { NextResponse, type NextRequest } from 'next/server'
// Default import (matches src/lib/sms/client.ts) — validateRequest is a static
// property on the SDK's `export =` object, so a named value import isn't
// guaranteed across the CJS interop; `twilio.validateRequest` always resolves.
import twilio from 'twilio'
import { createAdminClient } from '@/lib/supabase/admin'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { TICKET_TAG_RE, LEAD_TAG_RE } from '@/lib/conversation/tags'
import { maybeEnqueueAutoDraft } from '@/lib/ai/auto-draft'
import { echoInboundSmsToEmail } from '@/lib/sms/echo'
import type { OrgEmailContext } from '@/lib/email/send-org-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[twilio-inbound]'

// Twilio SMS webhooks always POST E.164 To/From. Guard the format before either
// value reaches a DB filter (defense-in-depth even though the signature already
// authenticated the request).
const E164_RE = /^\+[1-9]\d{6,15}$/

// Empty TwiML — the canonical "received, nothing to say back" acknowledgement.
// Used for every 200 outcome (matched, dropped, duplicate, ignored) so Twilio
// stops retrying and never auto-responds anything to the sender.
function twiml(logMsg?: string): NextResponse {
  if (logMsg) console.log(`${LOG} ${logMsg}`)
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

// Org context needed by both rails: routing numbers, loop-guard, echo email
// (OrgEmailContext fields) + the inbound tags that build the echo Reply-To.
type OrgRow = OrgEmailContext & {
  sms_support_number:     string | null
  sms_lead_number:        string | null
  inbound_email_tag:      string | null
  inbound_lead_email_tag: string | null
}

const ORG_SELECT =
  'id, name, sms_support_number, sms_lead_number, ' +
  'inbound_email_tag, inbound_lead_email_tag, ' +
  'verified_support_email, verified_support_email_confirmed_at, ' +
  'verified_lead_email, verified_lead_email_confirmed_at'

export async function POST(request: NextRequest) {
  // 1. Read the raw body once, then parse the form params (Twilio posts
  //    application/x-www-form-urlencoded). fromEntries is safe: Twilio never
  //    repeats a scalar key (MediaUrl0/1/… are distinct keys).
  const rawBody = await request.text()
  const params  = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>

  // 2. Signature validation. authToken is the same secret the outbound client
  //    uses. Unset → 500 (misconfiguration); mismatch → 401.
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error(`${LOG} TWILIO_AUTH_TOKEN not set — refusing to process inbound SMS`)
    return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  }

  // Rebuild the EXACT URL Twilio signed. Twilio signs the URL as configured in
  // the console; behind Vercel's proxy the platform rewrites Host to an internal
  // deploy host (and request.url reflects that), so we reconstruct the public URL
  // from the x-forwarded-* headers the proxy sets. The webhook is configured with
  // no query string, so `search` is empty and this matches byte-for-byte; if a
  // query is ever added, appending search keeps it correct.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(/:$/, '')
  const host  = request.headers.get('x-forwarded-host')  ?? request.headers.get('host') ?? request.nextUrl.host
  const url   = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`

  const signature = request.headers.get('x-twilio-signature') ?? ''
  if (!twilio.validateRequest(authToken, signature, url, params)) {
    console.warn(`${LOG} signature mismatch — url=${url} sig_present=${Boolean(signature)}`)
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  // 3. Extract the fields we use.
  const from      = (params.From ?? '').trim()
  const to        = (params.To   ?? '').trim()
  const messageSid = (params.MessageSid ?? params.SmsSid ?? '').trim()
  const numMedia  = Number.parseInt(params.NumMedia ?? '0', 10) || 0
  const rawText   = params.Body ?? ''
  // The body used for tag-matching is the raw text; the stored/echoed body falls
  // back to a media placeholder when the text is empty (MMS with no caption).
  const messageBody = rawText.trim() || (numMedia > 0 ? '[media message]' : '(empty)')

  if (!E164_RE.test(to) || !E164_RE.test(from)) {
    return twiml(`ignored — non-E164 to=${to || '-'} from=${from || '-'}`)
  }
  if (!messageSid) {
    return twiml('ignored — missing MessageSid')
  }

  const admin = createAdminClient()

  // 4. Resolve the org + rail by EXACT To match. Two single-column .eq queries
  //    (not a .or()) so a leading '+' in the phone can't confuse PostgREST filter
  //    parsing. Support wins if the number somehow matches both columns.
  const [supRes, leadRes] = await Promise.all([
    admin.from('organizations').select(ORG_SELECT).eq('sms_support_number', to).maybeSingle<OrgRow>(),
    admin.from('organizations').select(ORG_SELECT).eq('sms_lead_number', to).maybeSingle<OrgRow>(),
  ])

  let org:  OrgRow | null = null
  let rail: 'support' | 'lead' | null = null
  if (supRes.data) {
    org = supRes.data; rail = 'support'
    if (leadRes.data) console.warn(`${LOG} number ${to} matches both rails — routing to support (org=${org.id})`)
  } else if (leadRes.data) {
    org = leadRes.data; rail = 'lead'
  }

  if (!org || !rail) {
    return twiml(`ignored — no org for To=${to}`)
  }

  // 5. Loop guard — never ingest a message whose sender is one of the org's own
  //    numbers (a misconfigured forwarding chain would otherwise ping-pong).
  if (from === org.sms_support_number || from === org.sms_lead_number) {
    return twiml(`ignored — loop guard, from is an org number org=${org.id}`)
  }

  console.log(`${LOG} inbound rail=${rail} org=${org.id} from=${from} to=${to} sid=${messageSid} media=${numMedia}`)

  if (rail === 'support') {
    return handleSupport(admin, org, { from, messageSid, messageBody, rawText })
  }
  return handleLead(admin, org, { from, messageSid, messageBody, rawText })
}

type InboundCtx = {
  from:        string
  messageSid:  string
  messageBody: string
  rawText:     string
}

// ── Support rail (thread-only) ───────────────────────────────────────────────
async function handleSupport(
  admin: ReturnType<typeof createAdminClient>,
  org:   OrgRow,
  ctx:   InboundCtx,
): Promise<NextResponse> {
  // 5a. Idempotency — the SID is stored on ticket_messages.external_message_id.
  const { data: dup } = await admin
    .from('ticket_messages')
    .select('id')
    .eq('org_id', org.id)
    .eq('external_message_id', ctx.messageSid)
    .maybeSingle<{ id: string }>()
  if (dup) return twiml(`duplicate — sid=${ctx.messageSid} already stored`)

  type MatchedTicket = { id: string; display_id: string | null; subject: string; customer_id: string | null }
  let ticket: MatchedTicket | null = null

  // 6a. Tag match first: [tk_X] in the body → that ticket (org-scoped, live).
  const tagMatch = ctx.rawText.match(TICKET_TAG_RE)
  if (tagMatch) {
    const displayId = tagMatch[1].toLowerCase()
    const { data } = await admin
      .from('tickets')
      .select('id, display_id, subject, customer_id')
      .eq('organization_id', org.id)
      .eq('display_id', displayId)
      .is('deleted_at', null)
      .maybeSingle<MatchedTicket>()
    if (data) ticket = data
  }

  // 6b. Phone fallback: opted-in customer(s) with this number → their most
  //     recently active OPEN, non-platform ticket.
  if (!ticket) {
    const { data: customers } = await admin
      .from('customers')
      .select('id')
      .eq('organization_id', org.id)
      .eq('phone', ctx.from)
      .eq('sms_opt_in', true)
      .is('deleted_at', null)
    const customerIds = ((customers ?? []) as { id: string }[]).map(c => c.id)
    if (customerIds.length > 0) {
      const { data } = await admin
        .from('tickets')
        .select('id, display_id, subject, customer_id')
        .eq('organization_id', org.id)
        .in('customer_id', customerIds)
        .eq('is_platform_support', false)
        .eq('status', 'open')
        .is('deleted_at', null)
        .order('last_ticket_activity_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle<MatchedTicket>()
      if (data) ticket = data
    }
  }

  if (!ticket) return twiml(`no_matching_ticket — org=${org.id} from=${ctx.from}`)

  // Append the inbound row. sender_id null (system-written), channel 'sms',
  // provenance in inbound_from_phone + external_message_id (SID).
  const { data: inserted, error: insErr } = await admin
    .from('ticket_messages')
    .insert({
      ticket_id:           ticket.id,
      org_id:              org.id,
      sender_id:           null,
      body:                ctx.messageBody,
      type:                'public',
      channel:             'sms',
      inbound_from_phone:  ctx.from,
      external_message_id: ctx.messageSid,
    })
    .select('id')
    .single<{ id: string }>()
  if (insErr) {
    // 500 → Twilio retries; idempotency guard above prevents a double-insert.
    console.error(`${LOG} ticket append failed ticket=${ticket.id}: ${insErr.message}`)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Activity bump (the set_tickets_updated_at trigger refreshes updated_at too),
  // so the tickets-grid unseen dot shows until an agent opens it. Non-fatal.
  const { error: bumpErr } = await admin
    .from('tickets')
    .update({ last_ticket_activity_at: new Date().toISOString() })
    .eq('id', ticket.id)
  if (bumpErr) console.error(`${LOG} ticket activity bump failed ticket=${ticket.id}: ${bumpErr.message}`)

  // Email echo to the ticket's customer (their own words back into their inbox).
  if (ticket.customer_id) {
    const { data: cust } = await admin
      .from('customers')
      .select('email')
      .eq('id', ticket.customer_id)
      .maybeSingle<{ email: string | null }>()
    if (cust?.email) {
      const displayId   = ticket.display_id ?? ticket.id
      const baseSubject = ticket.subject.replace(/\[tk_[a-z0-9]+\]\s*/gi, '').trim()
      await echoInboundSmsToEmail({
        rail:        'support',
        org,
        toEmail:     cust.email,
        subject:     `[${displayId}] ${baseSubject || '(no subject)'}`,
        replyTo:     constructInboundEmailAddress(org.inbound_email_tag ?? null),
        threadingId: `<${displayId}@kinvox.com>`,
        fromPhone:   ctx.from,
        body:        ctx.messageBody,
      })
    } else {
      console.log(`${LOG} echo skipped — ticket ${ticket.id} customer has no email`)
    }
  }

  // Auto-draft on inbound (same gates as the email rail). Additive + best-effort.
  await maybeEnqueueAutoDraft(admin, org.id, ticket.id, inserted.id)

  return twiml(`appended_ticket ticket=${ticket.id} via=${tagMatch ? 'tag' : 'phone'}`)
}

// ── Lead rail (thread-only) ──────────────────────────────────────────────────
async function handleLead(
  admin: ReturnType<typeof createAdminClient>,
  org:   OrgRow,
  ctx:   InboundCtx,
): Promise<NextResponse> {
  // 5a. Idempotency — the SID is stored on lead_messages.provider_message_id.
  const { data: dup } = await admin
    .from('lead_messages')
    .select('id')
    .eq('organization_id', org.id)
    .eq('provider_message_id', ctx.messageSid)
    .maybeSingle<{ id: string }>()
  if (dup) return twiml(`duplicate — sid=${ctx.messageSid} already stored`)

  type MatchedLead = { id: string; display_id: string | null; email: string | null; status: string }
  let lead: MatchedLead | null = null

  // 7a. Tag match first: [ld_X] in the body → that lead (org-scoped, live, active).
  const tagMatch = ctx.rawText.match(LEAD_TAG_RE)
  if (tagMatch) {
    const displayId = tagMatch[1].toLowerCase()
    const { data } = await admin
      .from('leads')
      .select('id, display_id, email, status')
      .eq('organization_id', org.id)
      .eq('display_id', displayId)
      .is('archived_at', null)
      .is('deleted_at', null)
      .maybeSingle<MatchedLead>()
    if (data) lead = data
  }

  // 7b. Phone fallback: opted-in, non-archived lead(s) with this number, most
  //     recently active first. Converted leads are excluded (log + drop).
  if (!lead) {
    const { data: candidates } = await admin
      .from('leads')
      .select('id, display_id, email, status')
      .eq('organization_id', org.id)
      .eq('phone', ctx.from)
      .eq('sms_opt_in', true)
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('last_lead_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
    const rows = (candidates ?? []) as MatchedLead[]
    const active = rows.find(r => r.status !== 'converted')
    if (active) {
      lead = active
    } else if (rows.length > 0) {
      return twiml(`no_matching_lead — only converted lead(s) match org=${org.id} from=${ctx.from}`)
    }
  }

  if (!lead) return twiml(`no_matching_lead — org=${org.id} from=${ctx.from}`)

  // Append the inbound row. author_kind 'lead' (inbound), author_user_id null,
  // channel 'sms', provenance in inbound_from_phone + provider_message_id (SID).
  const { error: insErr } = await admin
    .from('lead_messages')
    .insert({
      lead_id:             lead.id,
      organization_id:     org.id,
      message_type:        'public_reply',
      author_kind:         'lead',
      author_user_id:      null,
      body:                ctx.messageBody,
      channel:             'sms',
      inbound_from_phone:  ctx.from,
      provider_message_id: ctx.messageSid,
    })
  if (insErr) {
    console.error(`${LOG} lead append failed lead=${lead.id}: ${insErr.message}`)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Activity bump so the leads-list dot shows until a user opens it. Non-fatal.
  const { error: bumpErr } = await admin
    .from('leads')
    .update({ last_lead_activity_at: new Date().toISOString() })
    .eq('id', lead.id)
  if (bumpErr) console.error(`${LOG} lead activity bump failed lead=${lead.id}: ${bumpErr.message}`)

  // Email echo to the lead (their own words back into their inbox). No auto-draft
  // on the lead rail.
  if (lead.email) {
    const displayId = lead.display_id ?? `ld_${lead.id}`
    await echoInboundSmsToEmail({
      rail:        'lead',
      org,
      toEmail:     lead.email,
      subject:     `[${displayId}] Update from ${org.name}`,
      replyTo:     constructInboundEmailAddress(org.inbound_lead_email_tag ?? null),
      threadingId: `<${displayId}@kinvox.com>`,
      fromPhone:   ctx.from,
      body:        ctx.messageBody,
    })
  } else {
    console.log(`${LOG} echo skipped — lead ${lead.id} has no email`)
  }

  return twiml(`appended_lead lead=${lead.id} via=${tagMatch ? 'tag' : 'phone'}`)
}
