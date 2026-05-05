'use server'

import { createClient } from '@/lib/supabase/server'
import { resolveEffectiveOrgId } from '@/lib/impersonation'
import { revalidatePath } from 'next/cache'
import type { Lead } from '@/lib/types/database.types'
import { sendOrgTransactionalEmail, type OrgEmailContext } from '@/lib/email/send-org-email'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { renderConversationReply, type PriorMessage } from '@/lib/email/templates/reply'

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

async function mirrorLeadToCustomer(
  supabase: Awaited<ReturnType<typeof createClient>>,
  m: MirrorArgs,
): Promise<void> {
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
    }
  }

  // 2. If no customer is now associated with this lead, insert one.
  const { data: already } = await supabase
    .from('customers')
    .select('id')
    .eq('organization_id', m.organizationId)
    .eq('lead_id', m.leadId)
    .maybeSingle()

  if (already) return

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
  }
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

  const { error } = await supabase.from('leads').update({
    first_name: firstName,
    last_name:  ((formData.get('last_name') as string) ?? '').trim() || null,
    company:    ((formData.get('company')   as string) ?? '').trim() || null,
    email:      ((formData.get('email')     as string) ?? '').trim() || null,
    phone:      ((formData.get('phone')     as string) ?? '').trim() || null,
    source,
  }).eq('id', leadId)

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/[orgSlug]/leads', 'page')
  return { status: 'success' }
}

const LEAD_STATUSES: Lead['status'][] = ['new', 'contacted', 'qualified', 'lost', 'converted']

export async function updateLeadStatus(leadId: string, status: string): Promise<void> {
  if (!(LEAD_STATUSES as string[]).includes(status)) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { error: updErr } = await supabase
    .from('leads')
    .update({ status: status as Lead['status'] })
    .eq('id', leadId)
  if (updErr) {
    console.warn(`[lead-status] update failed lead=${leadId}: ${updErr.message}`)
    return
  }

  // Convert-on-demand: when (and only when) the lead flips to 'converted'
  // for the first time, mirror it into customers. Any other status change
  // \u2014 including leaving 'converted' \u2014 leaves the customer row untouched
  // so downstream records (tickets, appointments) never lose their link.
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
        await mirrorLeadToCustomer(supabase, {
          leadId:         lead.id,
          organizationId: lead.organization_id,
          firstName:      lead.first_name,
          lastName:       lead.last_name,
          email:          lead.email,
          company:        lead.company,
        })
        revalidatePath('/customers')
      }
    }
  }

  revalidatePath(`/leads/${leadId}`)
  revalidatePath('/[orgSlug]/leads', 'page')
  revalidatePath('/')
}

export type AddNoteState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

export async function addLeadNote(
  leadId: string,
  _prev: AddNoteState,
  formData: FormData,
): Promise<AddNoteState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { status: 'error', error: 'Unauthorized' }

  const content = (formData.get('content') as string | null)?.trim()
  if (!content) return { status: 'error', error: 'Note cannot be empty' }

  const { error } = await supabase.from('lead_activities').insert({
    lead_id: leadId,
    user_id: user.id,
    content,
  })

  if (error) return { status: 'error', error: error.message }

  revalidatePath(`/leads/${leadId}`)
  return { status: 'success' }
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
    .select('id, organization_id, email, display_id, first_name')
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; organization_id: string; email: string | null; display_id: string | null; first_name: string }>()
  if (!lead || lead.organization_id !== orgId) return null
  return lead
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

  if (!lead.email) {
    return { status: 'error', error: 'Lead has no email address' }
  }

  // Pull the org's lead-notifications channel state. This is the channel
  // post-Sprint-3 split — verified_lead_email_*, NOT verified_support_email_*.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at, inbound_lead_email_tag')
    .eq('id', orgId)
    .single<OrgEmailContext & { inbound_lead_email_tag: string | null }>()
  if (!orgRow) return { status: 'error', error: 'Organization not found' }

  if (!orgRow.verified_lead_email_confirmed_at) {
    return {
      status: 'error',
      error:  'Lead notifications email is not verified yet — verify it in Lead Support settings before sending replies.',
      needs_lead_email_verification: true,
    }
  }

  const subjectBase = `Update from ${orgRow.name}`
  const subject     = lead.display_id
    ? `[${lead.display_id}] ${subjectBase}`
    : subjectBase

  // Replier identity: pull profiles.full_name for the authenticated user
  // so the rendered signature reads "— <first> at <org>". Null is fine —
  // the renderer falls back to "— <org> team".
  const { data: replierProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle<{ full_name: string | null }>()
  const replierFirstName = replierProfile?.full_name?.trim().split(/\s+/)[0] ?? null

  // Prior message for the quoted block: most recent public_reply on this
  // lead. The lead-magnet confirmation is NOT recorded in lead_messages,
  // so on the very first reply this returns null and the renderer skips
  // the quoted block — the customer already has the confirmation in their
  // inbox above.
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

  let prior: PriorMessage | null = null
  if (priorRow) {
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
      // Inbound row: prefer the lead's name, fall back to the raw From.
      const fallbackFromEmail = priorRow.inbound_email_from?.split('<')[0]?.trim().replace(/^"|"$/g, '') || ''
      senderName = lead.first_name?.trim() || fallbackFromEmail || priorRow.inbound_email_from || ''
    }
    if (!senderName) senderName = 'them'

    prior = {
      senderName,
      sentAt: new Date(priorRow.created_at),
      body:   priorRow.body,
    }
  }

  const { htmlBody, textBody } = renderConversationReply({
    leadFirstName:    lead.first_name,
    replierFirstName,
    orgName:          orgRow.name,
    body,
    prior,
  })

  // Reply-To + threading: same shape as the lead-confirmation send so
  // Gmail/Outlook keep the conversation grouped, and the prospect's reply
  // routes through the plus-addressed inbound mailbox into the lead
  // conversation panel via the postmark/inbound webhook.
  const replyTo     = constructInboundEmailAddress(orgRow.inbound_lead_email_tag)
  const threadingId = `<${lead.display_id ?? `ld_${lead.id}`}@kinvox.com>`
  if (!replyTo) {
    console.warn(`[outbound] inbound tag missing for org=${orgRow.id} channel=lead — reply-to omitted, customer replies will land in org's verified mailbox and bypass conversation panel`)
  }

  const sendResult = await sendOrgTransactionalEmail({
    org:               orgRow,
    to:                lead.email,
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
