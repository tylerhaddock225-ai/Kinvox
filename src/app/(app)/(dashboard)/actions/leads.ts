'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveEffectiveOrgId, revalidateOrgPath } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import type { Lead } from '@/lib/types/database.types'
import { sendOrgTransactionalEmail, type OrgEmailContext, type SendOrgEmailResult } from '@/lib/email/send-org-email'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { renderConversationReply, type PriorMessage } from '@/lib/email/templates/reply'
import { sendOrgSms } from '@/lib/sms/send-org-sms'
import { buildLeadSmsText } from '@/lib/sms/sms-format'
import { logLeadSmsSystemNote } from '@/lib/sms/consent-note'
import { normalizeToE164 } from '@/lib/phone'

export type CreateLeadState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export async function createLead(
  _prev: CreateLeadState,
  formData: FormData,
): Promise<CreateLeadState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization found' }

  const firstName = (formData.get('first_name') as string).trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const lastName = ((formData.get('last_name') as string).trim()) || null
  const company  = ((formData.get('company')   as string).trim()) || null
  const email    = ((formData.get('email')     as string).trim()) || null

  const { data: lead, error } = await supabase.from('leads').insert({
    organization_id: orgId,
    first_name: firstName,
    last_name:  lastName,
    company,
    email,
    source: (formData.get('source') as Lead['source']) || null,
    status: (formData.get('status') as Lead['status']) || 'new',
  }).select('id').single()

  if (error) return { status: 'error', error: error.message }

  // Customer creation is deferred until the lead is converted (see
  // updateLeadStatus below). The two tables stay decoupled at insert
  // time so a never-converted lead never shows up in Customers.
  void lead

  revalidatePath('/')
  revalidatePath('/[orgSlug]/leads', 'page')
  return { status: 'success' }
}

type MirrorArgs = {
  leadId:         string
  organizationId: string
  firstName:      string
  lastName:       string | null
  email:          string | null
  company:        string | null
}

type MirrorResult = { ok: true } | { ok: false; error: string }

async function mirrorLeadToCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  m: MirrorArgs,
): Promise<MirrorResult> {
  // 1. If a customer with this (org, email) already exists and isn't yet
  //    linked to a lead, attach this lead to it. The unique partial index
  //    on (organization_id, lower(email)) WHERE deleted_at IS NULL
  //    guarantees at most one match per email per org.
  if (m.email) {
    const { error: linkErr } = await supabase
      .from('customers')
      .update({ lead_id: m.leadId })
      .eq('organization_id', m.organizationId)
      .ilike('email', m.email.replace(/[\\%_]/g, c => '\\' + c))
      .is('deleted_at', null)
      .is('lead_id', null)
    if (linkErr) {
      console.warn(`[lead-mirror] link existing customer failed lead=${m.leadId}: ${linkErr.message}`)
      return { ok: false, error: linkErr.message }
    }
  }

  // 2. If no customer is now associated with this lead, insert one.
  const { data: already } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', m.organizationId)
    .eq('lead_id', m.leadId)
    .maybeSingle()

  if (already) return { ok: true }

  const { error: insErr } = await supabase.from('customers').insert({
    organization_id: m.organizationId,
    lead_id:         m.leadId,
    first_name:      m.firstName,
    last_name:       m.lastName,
    email:           m.email,
    company:         m.company,
  })
  if (insErr) {
    console.warn(`[lead-mirror] customer insert failed lead=${m.leadId}: ${insErr.message}`)
    return { ok: false, error: insErr.message }
  }
  return { ok: true }
}

const LEAD_SOURCES: NonNullable<Lead['source']>[] = ['web', 'referral', 'import', 'manual', 'other']

export type UpdateLeadState = CreateLeadState

export async function updateLead(
  leadId: string,
  _prev: UpdateLeadState,
  formData: FormData,
): Promise<UpdateLeadState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const firstName = ((formData.get('first_name') as string) ?? '').trim()
  if (!firstName) return { status: 'error', error: 'First name is required' }

  const rawSource = (formData.get('source') as string) || ''
  const source    = (LEAD_SOURCES as string[]).includes(rawSource) ? (rawSource as Lead['source']) : null

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  // Fail-open: normalize to E.164 for the SMS rail; store raw if it won't parse.
  const phoneRaw = ((formData.get('phone') as string) ?? '').trim()

  const { error } = await supabase.from('leads').update({
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      phoneRaw ? (normalizeToE164(phoneRaw) ?? phoneRaw) : null,
    source,
  }).eq('id', leadId)

  if (error) return { status: 'error', error: error.message }

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/leads/${leadId}`)
  }
  revalidatePath('/[orgSlug]/leads', 'page')
  return { status: 'success' }
}

// ── setLeadSmsOptIn ─────────────────────────────────────────────────────────
//
// SMS Stage 2a — org-side manual consent toggle (for verbal "just text me"
// consent). Mirrors setCustomerSmsOptIn: same gating as updateLead (auth + RLS).
// ON records consent + timestamp and nulls any pending token; OFF clears both.
// Consent state only — nothing is sent.

export async function setLeadSmsOptIn(leadId: string, optIn: boolean): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  const patch = optIn
    ? { sms_opt_in: true,  sms_opted_in_at: new Date().toISOString(), sms_opt_in_token: null }
    : { sms_opt_in: false, sms_opted_in_at: null,                     sms_opt_in_token: null }

  const { error } = await supabase.from('leads').update(patch).eq('id', leadId)
  if (error) {
    console.error(`[lead-sms-optin] update failed lead=${leadId}: ${error.message}`)
    return
  }

  // SMS-2b — record the consent change as a system note on the lead thread
  // (admin client for the author_kind='system' row; fail-open).
  if (orgId) {
    await logLeadSmsSystemNote(createAdminClient(), {
      leadId,
      orgId,
      body: optIn ? 'SMS opt-in set manually.' : 'SMS opt-in removed.',
    })
    await revalidateOrgPath(supabase, orgId, `/leads/${leadId}`)
  }
  revalidatePath('/[orgSlug]/leads', 'page')
}

const LEAD_STATUSES: Lead['status'][] = ['new', 'contacted', 'qualified', 'lost', 'converted']

export type UpdateLeadStatusState =
  | { status: 'success' }
  | { status: 'error'; error: string }

export async function updateLeadStatus(leadId: string, status: string): Promise<UpdateLeadStatusState> {
  if (!(LEAD_STATUSES as string[]).includes(status)) {
    return { status: 'error', error: 'Invalid status' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)

  // Read the current status so we can decide what to do with converted_at:
  // setting on transition INTO converted, clearing on transition OUT of
  // converted, untouched otherwise. The mirror itself is keyed on
  // 'next === converted' below, but converted_at is purely diagnostic and
  // is updated regardless of whether the mirror succeeds.
  const { data: existing } = await supabase
    .from('leads')
    .select('status')
    .eq('id', leadId)
    .maybeSingle<{ status: Lead['status'] }>()

  const prevStatus = existing?.status ?? null
  const update: { status: Lead['status']; converted_at?: string | null } = {
    status: status as Lead['status'],
  }
  if (status === 'converted' && prevStatus !== 'converted') {
    update.converted_at = new Date().toISOString()
  } else if (status !== 'converted' && prevStatus === 'converted') {
    update.converted_at = null
  }

  const { error: updErr } = await supabase
    .from('leads')
    .update(update)
    .eq('id', leadId)
  if (updErr) {
    console.warn(`[lead-status] update failed lead=${leadId}: ${updErr.message}`)
    return { status: 'error', error: updErr.message }
  }

  // Convert-on-demand: when (and only when) the lead flips to 'converted'
  // for the first time, mirror it into customers. Any other status change
  // \u2014 including leaving 'converted' \u2014 leaves the customer row untouched
  // so downstream records (tickets, appointments) never lose their link.
  //
  // The status update has already committed above. If the mirror fails we
  // surface the error to the caller but do NOT revert the status \u2014 the
  // user can manually re-toggle to retry once the underlying issue (RLS,
  // constraint, etc.) is resolved.
  let mirrorError: string | null = null
  if (status === 'converted') {
    // Pull the org-scoped lead snapshot the mirror helper needs.
    const { data: lead } = await supabase
      .from('leads')
      .select('id, organization_id, first_name, last_name, email, company')
      .eq('id', leadId)
      .is('deleted_at', null)
      .maybeSingle()

    if (lead) {
      const { data: already } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle()

      if (!already) {
        const result = await mirrorLeadToCustomer(supabase, {
          leadId:         lead.id,
          organizationId: lead.organization_id,
          firstName:      lead.first_name,
          lastName:       lead.last_name,
          email:          lead.email,
          company:        lead.company,
        })
        if (!result.ok) {
          mirrorError = result.error
        } else {
          await revalidateOrgPath(supabase, lead.organization_id, '/customers')
        }
      }
    }
  }

  if (orgId) {
    await revalidateOrgPath(supabase, orgId, `/leads/${leadId}`)
  }
  revalidatePath('/[orgSlug]/leads', 'page')
  revalidatePath('/')

  if (mirrorError) {
    return { status: 'error', error: `Status updated, but customer mirror failed: ${mirrorError}` }
  }
  return { status: 'success' }
}

// ── archiveLead / restoreLead ───────────────────────────────────────────────
//
// Archive sets archived_at to the current timestamp. Archived leads are
// hidden from the active leads list but preserved in the database; the
// magnet capture-action restores the row automatically when the same email
// resubmits the form (see src/app/(public)/l/[slug]/actions.ts). RLS is
// already org-scoped on leads, but the explicit organization_id filter on
// the update guards against an HQ admin accidentally archiving a row
// outside the impersonation scope.

export async function archiveLead(formData: FormData): Promise<void> {
  const leadId = String(formData.get('lead_id') ?? '').trim()
  if (!leadId) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return

  await supabase
    .from('leads')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('organization_id', orgId)

  await revalidateOrgPath(supabase, orgId, '/leads')
  await revalidateOrgPath(supabase, orgId, `/leads/${leadId}`)
}

export async function restoreLead(formData: FormData): Promise<void> {
  const leadId = String(formData.get('lead_id') ?? '').trim()
  if (!leadId) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return

  await supabase
    .from('leads')
    .update({ archived_at: null })
    .eq('id', leadId)
    .eq('organization_id', orgId)

  await revalidateOrgPath(supabase, orgId, '/leads')
  await revalidateOrgPath(supabase, orgId, `/leads/${leadId}`)
}


// ── Lead conversation (lead_messages) ───────────────────────────────────
//
// Two surfaces: an internal note (org-only) and a public reply (sent via
// Postmark from the Organization's verified lead-notifications email and
// threaded back via the [ld_<display_id>] tag handled in the inbound
// webhook). Both write to lead_messages; only public_reply does I/O.

export type LeadMessageState =
  | { status: 'success' }
  | { status: 'error';   error: string;
                          // Specific error for "lead-notifications email
                          // not yet verified" — UI surfaces a settings link.
                          needs_lead_email_verification?: boolean }
  | null

async function resolveLeadInOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  leadId:   string,
  orgId:    string,
) {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, organization_id, email, phone, sms_opt_in, display_id, first_name, status')
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle<{
      id: string; organization_id: string; email: string | null
      phone: string | null; sms_opt_in: boolean | null
      display_id: string | null; first_name: string; status: string
    }>()
  if (!lead || lead.organization_id !== orgId) return null
  return lead
}

type LeadReplyLead = NonNullable<Awaited<ReturnType<typeof resolveLeadInOrg>>>
type LeadReplyOrg  = OrgEmailContext & { inbound_lead_email_tag: string | null; sms_lead_number: string | null }

// Prior public_reply on this lead, shaped for the quoted block. Extracted so both
// the email path and the SMS path's email copy resolve it BEFORE inserting the
// new row (never quoting the in-flight message). Mirrors the original inline logic.
async function resolveLeadPriorMessage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lead:     LeadReplyLead,
): Promise<PriorMessage | null> {
  const { data: priorRow } = await supabase
    .from('lead_messages')
    .select('body, created_at, author_kind, author_user_id, inbound_email_from')
    .eq('lead_id', lead.id)
    .eq('message_type', 'public_reply')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      body:               string
      created_at:         string
      author_kind:        'org_user' | 'lead' | 'system'
      author_user_id:     string | null
      inbound_email_from: string | null
    }>()
  if (!priorRow) return null

  let senderName = ''
  if (priorRow.author_kind === 'org_user' && priorRow.author_user_id) {
    const { data: priorProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', priorRow.author_user_id)
      .maybeSingle<{ full_name: string | null }>()
    senderName = priorProfile?.full_name?.trim() || ''
  }
  if (!senderName && priorRow.author_kind === 'lead') {
    const fallbackFromEmail = priorRow.inbound_email_from?.split('<')[0]?.trim().replace(/^"|"$/g, '') || ''
    senderName = lead.first_name?.trim() || fallbackFromEmail || priorRow.inbound_email_from || ''
  }
  if (!senderName) senderName = 'them'

  return { senderName, sentAt: new Date(priorRow.created_at), body: priorRow.body }
}

// Render + send a lead public reply as email over the lead rail. Shared by the
// email path (its primary send) and the SMS path (its non-fatal email copy) so
// both carry an identical subject tag / Reply-To and thread together.
async function sendLeadReplyEmail(args: {
  orgRow:           LeadReplyOrg
  lead:             LeadReplyLead
  toEmail:          string
  replierFirstName: string | null
  body:             string
  prior:            PriorMessage | null
}): Promise<SendOrgEmailResult> {
  const { orgRow, lead, toEmail, replierFirstName, body, prior } = args
  const subjectBase = `Update from ${orgRow.name}`
  const subject     = lead.display_id ? `[${lead.display_id}] ${subjectBase}` : subjectBase

  const { htmlBody, textBody } = renderConversationReply({
    leadFirstName: lead.first_name,
    replierFirstName,
    orgName:       orgRow.name,
    body,
    prior,
  })

  const replyTo     = constructInboundEmailAddress(orgRow.inbound_lead_email_tag)
  const threadingId = `<${lead.display_id ?? `ld_${lead.id}`}@kinvox.com>`
  if (!replyTo) {
    console.warn(`[outbound] inbound tag missing for org=${orgRow.id} channel=lead — reply-to omitted, customer replies will land in org's verified mailbox and bypass conversation panel`)
  }

  return sendOrgTransactionalEmail({
    org:               orgRow,
    to:                toEmail,
    subject,
    htmlBody,
    textBody,
    tag:               'lead-reply',
    fromAddressSource: 'lead',
    replyTo:           replyTo ?? undefined,
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })
}

export async function postLeadInternalNote(
  leadId: string,
  _prev:  LeadMessageState,
  formData: FormData,
): Promise<LeadMessageState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const body = (formData.get('body') as string | null)?.trim() ?? ''
  if (!body) return { status: 'error', error: 'Note cannot be empty' }

  const lead = await resolveLeadInOrg(supabase, leadId, orgId)
  if (!lead) return { status: 'error', error: 'Lead not found' }

  const { error } = await supabase.from('lead_messages').insert({
    lead_id:         lead.id,
    organization_id: orgId,
    message_type:    'internal_note',
    author_kind:     'org_user',
    author_user_id:  user.id,
    body,
  })
  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/[orgSlug]/leads/${leadId}`, 'page')
  return { status: 'success' }
}

export async function postLeadPublicReply(
  leadId: string,
  _prev:  LeadMessageState,
  formData: FormData,
): Promise<LeadMessageState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Not authenticated' }

  const orgId = await resolveEffectiveOrgId(supabase, user.id)
  if (!orgId) return { status: 'error', error: 'No organization' }

  const body = (formData.get('body') as string | null)?.trim() ?? ''
  if (!body) return { status: 'error', error: 'Reply cannot be empty' }

  const lead = await resolveLeadInOrg(supabase, leadId, orgId)
  if (!lead) return { status: 'error', error: 'Lead not found' }

  // Backstop for the LeadConversationPanel UI gate: refuse public replies
  // on terminal leads even if the client somehow bypasses the disabled
  // composer. Internal notes are unaffected.
  if (lead.status === 'converted') {
    return { status: 'error', error: 'Lead is converted — public replies disabled.' }
  }

  // SMS-2b — reply channel. Absent/unknown → 'email' so every existing caller
  // keeps its exact prior behavior.
  const channelRaw = formData.get('channel') as string | null
  const channel: 'email' | 'sms' = channelRaw === 'sms' ? 'sms' : 'email'

  // Pull the org's lead-notifications channel state (+ the SMS lead number for
  // the SMS path). This is the channel post-Sprint-3 split — verified_lead_email_*,
  // NOT verified_support_email_*.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at, inbound_lead_email_tag, sms_lead_number')
    .eq('id', orgId)
    .single<LeadReplyOrg>()
  if (!orgRow) return { status: 'error', error: 'Organization not found' }

  // Replier identity: pull profiles.full_name for the authenticated user so the
  // rendered signature reads "— <first> at <org>". Null is fine — the renderer
  // falls back to "— <org> team".
  const { data: replierProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle<{ full_name: string | null }>()
  const replierFirstName = replierProfile?.full_name?.trim().split(/\s+/)[0] ?? null

  // ── SMS path ────────────────────────────────────────────────────────────────
  // Mirrors the ticket SMS pattern with lead semantics: consent + phone gate
  // BEFORE any write, row-first persistence, best-effort send, then an email copy.
  if (channel === 'sms') {
    if (!lead.sms_opt_in) return { status: 'error', error: 'not_opted_in' }
    const leadPhone = lead.phone ? normalizeToE164(lead.phone) : null
    if (!leadPhone) return { status: 'error', error: 'no_recipient_phone' }

    // Resolve prior BEFORE inserting so the email copy's quoted block references
    // the message before this one, not the SMS row we're about to write.
    const prior = await resolveLeadPriorMessage(supabase, lead)

    // Persist the row FIRST (row is the source of truth; the send is best-effort
    // after). RLS insert policy requires author_kind 'org_user' + author_user_id
    // = auth.uid() — matches the email path below.
    const { data: insertedRow, error: insErr } = await supabase
      .from('lead_messages')
      .insert({
        lead_id:         lead.id,
        organization_id: orgId,
        message_type:    'public_reply',
        author_kind:     'org_user',
        author_user_id:  user.id,
        body,
        channel:         'sms',
      })
      .select('id')
      .single<{ id: string }>()
    if (insErr) return { status: 'error', error: insErr.message }

    // Send over the lead rail. The body is header-framed ("[ld_X] <org>\n\n<body>")
    // so an inbound reply threads back via the tag; the stored row body stays raw.
    const smsText = buildLeadSmsText({
      displayId: lead.display_id ?? `ld_${lead.id}`,
      orgName:   orgRow.name,
      body,
    })
    const sendRes = await sendOrgSms({
      org:  { id: orgRow.id, sms_support_number: null, sms_lead_number: orgRow.sms_lead_number },
      rail: 'lead',
      to:   leadPhone,
      body: smsText,
    })
    if (sendRes.ok) {
      // provider_message_id write needs the admin client — lead_messages has no
      // UPDATE RLS policy (parity with the ticket SID write via the admin client).
      const admin = createAdminClient()
      const { error: sidErr } = await admin
        .from('lead_messages')
        .update({ provider_message_id: sendRes.providerMessageId })
        .eq('id', insertedRow.id)
      if (sidErr) console.error(`[lead-sms] provider-id write failed lead=${lead.id} msg=${insertedRow.id}: ${sidErr.message}`)
    } else {
      console.error(`[lead-sms] send failed lead=${lead.id}: ${sendRes.error}`)
    }

    // Canon #3 — email copy of the same reply through the lead rail's email
    // machinery (same subject tag + Reply-To so it threads). Non-fatal + logged;
    // skipped only when the lead has no email on file.
    if (lead.email) {
      const copy = await sendLeadReplyEmail({ orgRow, lead, toEmail: lead.email, replierFirstName, body, prior })
      if (!copy.ok) console.error(`[lead-sms] email copy failed lead=${lead.id}: ${copy.error}`)
    }

    revalidatePath(`/[orgSlug]/leads/${leadId}`, 'page')
    if (!sendRes.ok) return { status: 'error', error: 'sms_send_failed' }
    return { status: 'success' }
  }

  // ── Email path (unchanged behavior) ──────────────────────────────────────────
  if (!lead.email) {
    return { status: 'error', error: 'Lead has no email address' }
  }
  if (!orgRow.verified_lead_email_confirmed_at) {
    return {
      status: 'error',
      error:  'Lead notifications email is not verified yet — verify it in Lead Support settings before sending replies.',
      needs_lead_email_verification: true,
    }
  }

  // Prior message for the quoted block: most recent public_reply on this lead.
  // The lead-magnet confirmation is NOT recorded in lead_messages, so on the very
  // first reply this returns null and the renderer skips the quoted block.
  const prior = await resolveLeadPriorMessage(supabase, lead)

  const sendResult = await sendLeadReplyEmail({ orgRow, lead, toEmail: lead.email, replierFirstName, body, prior })
  if (!sendResult.ok) {
    return { status: 'error', error: sendResult.error }
  }

  // Only persist after Postmark accepts — never record sends that didn't
  // actually go out.
  const { error: insErr } = await supabase.from('lead_messages').insert({
    lead_id:             lead.id,
    organization_id:     orgId,
    message_type:        'public_reply',
    author_kind:         'org_user',
    author_user_id:      user.id,
    body,
    postmark_message_id: sendResult.messageId,
  })
  if (insErr) return { status: 'error', error: insErr.message }

  revalidatePath(`/[orgSlug]/leads/${leadId}`, 'page')
  return { status: 'success' }
}
