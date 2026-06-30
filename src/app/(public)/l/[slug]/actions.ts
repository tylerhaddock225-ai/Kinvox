'use server'

// Public lead-magnet capture — server action variant.
//
// Sprint 3 model: leads from this form are *conversions* — the prospect
// already self-identified after seeing an unlocked AI reply. There is no
// per-lead paywall; the credit was already spent at the signal-unlock
// step. So:
//   1. Geocode the visitor's "Service Address" via lib/geo.ts.
//   2. Compare the resulting point against the org's saved epicenter +
//      signal_radius — purely informational; we still capture the lead
//      either way so the merchant has visibility.
//   3. Insert the lead with status='new' (no unlock cycle).
//   4. If the visitor is INSIDE the service area, also insert an
//      appointments row using the datetime they picked. Out-of-area
//      visitors are captured but not booked — driving miles for a
//      non-fit isn't the merchant's preferred outcome.
//
// Zero-Inference: organization_id is resolved server-side from the slug
// embedded in the form. Anything the client claims about org id, coords,
// fence, or owner is ignored. The appointments row inherits the same
// resolved org id, never anything from the form payload.

import { ServerClient } from 'postmark'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress, haversineMiles } from '@/lib/geo'
import { isLeadCaptureLive } from '@/lib/lead-magnet'
import { sendOrgTransactionalEmail } from '@/lib/email/send-org-email'
import { constructInboundEmailAddress } from '@/lib/email/inbound-address'
import { renderLeadConfirmationEmail } from '@/lib/email/templates/lead-confirmation'
import { normalizeLeadQuestions, type LeadQuestion } from '@/lib/lead-questions'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CaptureLeadState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

type OrgRow = {
  id:                                  string
  name:                                string
  owner_id:                            string
  latitude:                            number | null
  longitude:                           number | null
  signal_radius:                       number | null
  lead_magnet_settings:                { enabled?: boolean } | null
  deleted_at:                          string | null
  verified_support_email:              string | null
  verified_support_email_confirmed_at: string | null
  verified_lead_email:                 string | null
  verified_lead_email_confirmed_at:    string | null
  inbound_lead_email_tag:              string | null
  feature_flags:                       Record<string, unknown> | null
  subscription_status:                 string | null
  custom_lead_questions:               unknown
  confirmation_email_template:         { subject?: string | null; body?: string | null } | null
}

export async function captureLeadAction(
  _prev: CaptureLeadState,
  formData: FormData,
): Promise<CaptureLeadState> {
  const slug            = String(formData.get('slug')           ?? '').trim().toLowerCase()
  const name            = String(formData.get('name')           ?? '').trim()
  const email           = String(formData.get('email')          ?? '').trim().toLowerCase()
  const phone           = String(formData.get('phone')          ?? '').trim()
  const address         = String(formData.get('address')        ?? '').trim()
  const appointmentAt   = String(formData.get('appointment_at') ?? '').trim()
  const signalIdRaw     = String(formData.get('signal_id')      ?? '').trim()
  const signalIdCandidate = UUID_RE.test(signalIdRaw) ? signalIdRaw : null

  if (!slug)                 return { status: 'error', error: 'Missing slug' }
  if (!name)                 return { status: 'error', error: 'Name is required' }
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Enter a valid email address' }
  if (!phone)                return { status: 'error', error: 'Phone is required' }
  if (!address)              return { status: 'error', error: 'Service address is required' }
  if (!appointmentAt)        return { status: 'error', error: 'Pick a date and time' }

  // datetime-local sends "YYYY-MM-DDTHH:MM" with no timezone. We treat the
  // value as UTC for storage simplicity in the sandbox; real production
  // would resolve through the org's saved timezone. The Date round-trip
  // also rejects malformed values.
  const apptDate = new Date(appointmentAt)
  if (Number.isNaN(apptDate.getTime())) {
    return { status: 'error', error: 'Pick a valid date and time' }
  }
  if (apptDate.getTime() < Date.now() - 60_000) {
    return { status: 'error', error: 'Appointment time must be in the future' }
  }
  const apptIso = apptDate.toISOString()

  // Service-role: anonymous public submission. We re-resolve the slug here
  // and never trust an organization_id from the form payload (Zero-Inference).
  const supabase = createAdminClient()

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, owner_id, latitude, longitude, signal_radius, lead_magnet_settings, deleted_at, verified_support_email, verified_support_email_confirmed_at, verified_lead_email, verified_lead_email_confirmed_at, inbound_lead_email_tag, feature_flags, subscription_status, custom_lead_questions, confirmation_email_template')
    .ilike('lead_magnet_slug', slug)
    .is('deleted_at', null)
    .maybeSingle<OrgRow>()

  if (orgErr) return { status: 'error', error: 'Lookup failed' }
  if (!org)   return { status: 'error', error: 'This landing page is not available' }
  if (!isLeadCaptureLive(org)) {
    return { status: 'error', error: 'This landing page is not available' }
  }

  // Attribution: only honour the supplied signal_id if it actually points
  // at a pending_signal that belongs to *this* org. A visitor pasting a
  // ?sig=<other-tenant-uuid> in the URL must not write attribution into
  // someone else's tenancy. Zero-Inference: the org id we compare against
  // came from the slug lookup above, never from the form payload.
  let attributedSignalId: string | null = null
  if (signalIdCandidate) {
    const { data: sig } = await supabase
      .from('pending_signals')
      .select('id, organization_id')
      .eq('id', signalIdCandidate)
      .maybeSingle<{ id: string; organization_id: string }>()
    if (sig && sig.organization_id === org.id) {
      attributedSignalId = sig.id
    }
  }

  // Geofence is informational here — leads are captured regardless. The
  // flag drives whether we book the appointment + which email copy fires.
  let geofence: 'inside' | 'outside' = 'inside'
  let distanceMiles: number | null   = null

  if (
    typeof org.latitude      === 'number' &&
    typeof org.longitude     === 'number' &&
    typeof org.signal_radius === 'number'
  ) {
    const point = geocodeAddress(address, { lat: org.latitude, lng: org.longitude })
    distanceMiles = haversineMiles(
      point.lat, point.lng,
      org.latitude, org.longitude,
    )
    geofence = distanceMiles <= org.signal_radius ? 'inside' : 'outside'
  }

  // Crude name split — first token is first_name, remainder is last_name.
  // The leads table requires first_name; fall back to a literal so we don't
  // 23502 on a single-token name like "Cher".
  const trimmedName = name.replace(/\s+/g, ' ')
  const spaceIdx    = trimmedName.indexOf(' ')
  const firstName   = spaceIdx === -1 ? trimmedName : trimmedName.slice(0, spaceIdx)
  const lastName    = spaceIdx === -1 ? null        : trimmedName.slice(spaceIdx + 1)

  // Collect tenant-defined custom answers. The form names them `q_<id>`;
  // we accept any string field with that prefix and cap to 20 entries.
  const customAnswers: Array<{ question_id: string; answer: string }> = []
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('q_')) continue
    if (typeof value !== 'string') continue
    const answer = value.trim()
    if (!answer) continue
    customAnswers.push({ question_id: key.slice(2), answer: answer.slice(0, 2000) })
    if (customAnswers.length >= 20) break
  }

  const homesteadRaw = formData.get('homestead_exemption')
  const homestead    = homesteadRaw === 'on' || homesteadRaw === 'true'
  const homesteadProvided = homesteadRaw !== null

  const metadata: Record<string, unknown> = {
    captured_via: 'lead_magnet',
    slug,
    address,
    geofence,
    requested_appointment_at: apptIso,
    tags:         ['lead_magnet'],
  }
  if (distanceMiles !== null)  metadata.distance_miles      = Number(distanceMiles.toFixed(2))
  if (homesteadRaw   !== null) metadata.homestead_exemption = homestead
  if (customAnswers.length)    metadata.custom_answers      = customAnswers
  // Attribution trail: links the lead row back to the originating signal so
  // the merchant (and HQ) can trace social-post → unlock → form submission.
  if (attributedSignalId)      metadata.signal_id           = attributedSignalId

  // Label custom answers for both branches (new lead confirmation + resubmission
  // system message). Cheap join against the org's saved questionnaire.
  const customAnswersWithLabels = labelCustomAnswers(customAnswers, org.custom_lead_questions)

  // ── Resubmission branch ──────────────────────────────────────────────────
  // Pre-insert existence check. The leads_org_email_unique partial index
  // (organization_id, email) WHERE deleted_at IS NULL would 23505 on a
  // duplicate insert; checking here lets us record the resubmission as a
  // system message instead of silently swallowing it. INCLUDES archived
  // leads so a resubmit auto-restores the previously archived row.
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, status, archived_at, display_id')
    .eq('organization_id', org.id)
    .eq('email', email)
    .maybeSingle<{
      id:           string
      status:       string
      archived_at:  string | null
      display_id:   string | null
    }>()

  if (existingLead) {
    const isArchived = existingLead.archived_at !== null
    const isDisposed = existingLead.status === 'converted' || existingLead.status === 'lost'
    const willReopen = isArchived || isDisposed

    const updates: Record<string, unknown> = {
      // Explicit updated_at touch — guarantees the row UPDATE fires the
      // set_leads_updated_at trigger even on the active branch where no
      // other fields change. Trigger overwrites with NOW() server-side.
      updated_at: new Date().toISOString(),
      // Phase 6b: form resubmission is a lead-originated event, so bump
      // last_lead_activity_at. Distinct from updated_at, which fires on
      // every UPDATE including org-side writes (status, edit, archive).
      last_lead_activity_at: new Date().toISOString(),
    }
    if (isArchived) updates.archived_at = null
    if (willReopen) updates.status      = 'new'

    const { error: updErr } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', existingLead.id)
    if (updErr) {
      console.error(`[lead-capture] resubmission update failed lead=${existingLead.id}: ${updErr.message}`)
    }

    // Phase 6d-inline: resubmissions now create a new appointment via the
    // same path as the new-lead branch. Bookings remain gated by
    // geofence === 'inside'; out-of-area resubmissions stay advisory only.
    // assigned_to defaults to the org's Lead Email pseudo-agent inbox so
    // the appointment routes to verified_lead_email and lands in the
    // inbox-owned "Lead Email" agent view (Workstream F).
    let appointmentBooked = false
    let appointmentInsertFailed = false
    let resubmissionApptTitle:     string | null = null
    let resubmissionApptDisplayId: string | null = null
    if (geofence === 'inside') {
      const { data: leadInbox } = await supabase
        .from('profiles')
        .select('id')
        .eq('organization_id', org.id)
        .eq('is_org_inbox', true)
        .eq('org_inbox_kind', 'lead')
        .maybeSingle<{ id: string }>()

      const { data: createdAppt, error: apptErr } = await supabase
        .from('appointments')
        .insert({
          organization_id: org.id,
          lead_id:         existingLead.id,
          // W1-1: author as the org's lead-inbox bot (resolved above), falling
          // back to the owner — keeps lead-magnet booking working for an ownerless
          // org instead of failing the NOT-NULL created_by FK.
          created_by:      leadInbox?.id ?? org.owner_id,
          assigned_to:     leadInbox?.id ?? null,
          title:           `Initial consultation — ${trimmedName}`,
          description:     `Booked from ${slug} lead magnet resubmission. Service address: ${address}`,
          start_at:        apptIso,
          status:          'scheduled',
        })
        .select('id, display_id, title')
        .single<{ id: string; display_id: string | null; title: string }>()

      if (apptErr) {
        appointmentInsertFailed = true
        console.error(
          `[lead-capture] resubmission appointment insert failed lead=${existingLead.id}: ${apptErr.message}`,
        )
      } else {
        appointmentBooked = true
        resubmissionApptTitle     = createdAppt?.title ?? null
        resubmissionApptDisplayId = createdAppt?.display_id ?? null
      }
    }

    const sysBody = composeResubmissionMessageBody({
      isArchived,
      isDisposed,
      priorStatus:    existingLead.status,
      trimmedName,
      phone,
      address,
      apptIso,
      customAnswersWithLabels,
      homestead:      homesteadProvided ? homestead : null,
      geofence,
      distanceMiles,
      appointmentBooked,
      appointmentInsertFailed,
      apptTitle:      resubmissionApptTitle,
      apptDisplayId:  resubmissionApptDisplayId,
    })
    const { error: msgErr } = await supabase.from('lead_messages').insert({
      lead_id:         existingLead.id,
      organization_id: org.id,
      author_kind:     'system',
      message_type:    'internal_note',
      author_user_id:  null,
      body:            sysBody,
    })
    if (msgErr) {
      console.error(`[lead-capture] resubmission system message insert failed lead=${existingLead.id}: ${msgErr.message}`)
    }

    // Re-fire the merchant alert with a [Resubmission] subject prefix so the
    // merchant can distinguish in their inbox.
    await sendLeadAlertEmail({
      org,
      geofence,
      distanceMiles,
      fullName:      trimmedName,
      phone,
      appointmentAt: appointmentBooked ? apptIso : null,
      subjectPrefix: '[Resubmission] ',
    })

    // Re-send confirmation to the prospect. appointmentTime carries the
    // booked time when a new appointment landed; otherwise the confirmation
    // copy collapses to the no-appointment variant.
    await dispatchLeadConfirmation({
      org,
      email,
      firstName,
      address,
      phone,
      customAnswersWithLabels,
      appointmentTime: appointmentBooked ? formatAppointmentTime(apptIso) : null,
      leadDisplayId:   existingLead.display_id,
      leadId:          existingLead.id,
    })

    return { status: 'success' }
  }
  // ── End resubmission branch ──────────────────────────────────────────────

  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      organization_id:       org.id,
      first_name:            firstName || 'Unknown',
      last_name:             lastName,
      email,
      phone,
      status:                'new',
      source:                'web',
      metadata,
      // Phase 6b: capture-flow INSERT is itself the first lead-originated
      // event for this lead row.
      last_lead_activity_at: new Date().toISOString(),
    })
    .select('id, display_id')
    .single<{ id: string; display_id: string | null }>()

  if (insertErr) {
    // Race-condition guard: if a concurrent submission landed between our
    // existence check and the insert, the unique index trips 23505 here.
    // Treat as idempotent success — the other submission's resubmission
    // path already handled the activity bookkeeping.
    if (insertErr.code === '23505') return { status: 'success' }
    return { status: 'error', error: 'Submission failed — please try again.' }
  }
  // .single() guarantees `lead` is non-null when error is null; the narrowing
  // is for TypeScript's benefit (and a defensive fallback if Supabase ever
  // changes the contract).
  if (!lead) return { status: 'error', error: 'Submission failed — please try again.' }

  // Appointment booking: only for in-area visitors. The created_by FK
  // requires a real auth user — we use the org's owner since the booking
  // is being made on the org's behalf, not by an individual employee.
  // Zero-Inference: org.id and org.owner_id come from the slug lookup,
  // never from the form payload.
  let appointmentBooked = false
  if (geofence === 'inside' && lead?.id) {
    // Default assignment for lead-magnet appointments is the org's Lead Email
    // pseudo-agent inbox — so notifications route to verified_lead_email and
    // the row appears in the inbox-owned "Lead Email" agent view. The trigger
    // + backfill data-op guarantee this profile exists for every org.
    const { data: leadInbox } = await supabase
      .from('profiles')
      .select('id')
      .eq('organization_id', org.id)
      .eq('is_org_inbox', true)
      .eq('org_inbox_kind', 'lead')
      .maybeSingle<{ id: string }>()

    const { data: createdAppt, error: apptErr } = await supabase
      .from('appointments')
      .insert({
        organization_id: org.id,
        lead_id:         lead.id,
        // W1-1: author as the org's lead-inbox bot (resolved above), falling
        // back to the owner — keeps lead-magnet booking working for an ownerless
        // org instead of failing the NOT-NULL created_by FK.
        created_by:      leadInbox?.id ?? org.owner_id,
        assigned_to:     leadInbox?.id ?? null,
        title:           `Initial consultation — ${trimmedName}`,
        description:     `Booked from ${slug} lead magnet. Service address: ${address}`,
        start_at:        apptIso,
        status:          'scheduled',
      })
      .select('id, display_id')
      .single<{ id: string; display_id: string | null }>()

    if (apptErr) {
      // Lead is captured; surface the booking failure in metadata for HQ
      // reconciliation but never bubble to the public visitor — they did
      // their part.
      console.error(`[lead-capture] appointment insert failed lead=${lead.id}: ${apptErr.message}`)
      await supabase
        .from('leads')
        .update({ metadata: { ...metadata, appointment_error: apptErr.message } })
        .eq('id', lead.id)
    } else {
      appointmentBooked = true

      // Workstream F Hotfix #7: activity note on the new lead's detail
      // page for the just-booked appointment. Mirrors the dashboard
      // createAppointment system-note pattern. Non-fatal — the lead and
      // appointment rows already exist.
      if (createdAppt?.display_id) {
        const activityBody = `Appointment booked: Initial consultation — ${trimmedName} on ${new Date(apptIso).toLocaleString()}. Reference: ${createdAppt.display_id}`
        const { error: noteErr } = await supabase.from('lead_messages').insert({
          lead_id:         lead.id,
          organization_id: org.id,
          author_kind:     'system',
          message_type:    'internal_note',
          author_user_id:  null,
          body:            activityBody,
        })
        if (noteErr) {
          console.error(`[lead-capture] new-lead appointment activity note failed lead=${lead.id} appt=${createdAppt.display_id}: ${noteErr.message}`)
        }
      }
    }
  }

  // Notification: tells the Organization about the conversion. Sprint 3
  // copy: form-captured leads are confirmed conversions, not paywall
  // teasers, so the email is celebratory + actionable, not a unlock-CTA.
  await sendLeadAlertEmail({
    org,
    geofence,
    distanceMiles,
    fullName: trimmedName,
    phone,
    appointmentAt: appointmentBooked ? apptIso : null,
  })

  // Customer-facing confirmation. Non-fatal — the lead is already
  // captured, the Organization already has its alert; the only loss
  // here is the prospect's acknowledgment, which can be retried/resent
  // out-of-band. Failures are logged inside the helper.
  await dispatchLeadConfirmation({
    org,
    email,
    firstName,
    address,
    phone,
    customAnswersWithLabels,
    appointmentTime: appointmentBooked ? formatAppointmentTime(apptIso) : null,
    leadDisplayId:   lead?.display_id ?? null,
    leadId:          lead.id,
  })

  return { status: 'success' }
}

// Pair each captured answer with its question label by joining against
// the Organization's saved questionnaire. If a question_id has been
// deleted between capture and send (race against questionnaire edits),
// fall back to the raw question_id so the email still ships.
function labelCustomAnswers(
  answers: Array<{ question_id: string; answer: string }>,
  questionnaire: unknown,
): Array<{ label: string; answer: string }> {
  if (!answers.length) return []
  const questions: LeadQuestion[] = normalizeLeadQuestions(questionnaire)
  const labelById = new Map<string, string>()
  for (const q of questions) labelById.set(q.id, q.label)
  return answers.map((a) => ({
    label:  labelById.get(a.question_id) ?? a.question_id,
    answer: a.answer,
  }))
}

// Human-readable appointment timestamp for the customer-facing email.
// No new dependency — Intl.DateTimeFormat with sensible defaults. We
// don't yet have per-Organization timezone configuration, so this falls
// back to UTC; once timezone shipping lands (later sprint), thread it
// through here.
function formatAppointmentTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    weekday:  'long',
    month:    'long',
    day:      'numeric',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(d)
}

type LeadAlertArgs = {
  org:           OrgRow
  geofence:      'inside' | 'outside'
  distanceMiles: number | null
  fullName:      string
  phone:         string
  appointmentAt: string | null
  // Optional inbox-side marker, e.g. "[Resubmission] " — prepended verbatim
  // to the auto-generated subject so the merchant can filter / triage.
  subjectPrefix?: string
}

async function sendLeadAlertEmail({
  org,
  geofence,
  distanceMiles,
  fullName,
  phone,
  appointmentAt,
  subjectPrefix,
}: LeadAlertArgs): Promise<void> {
  const LOG = '[lead-alert]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — skipping alert for org=${org.id}`)
    return
  }

  const recipient =
    org.verified_lead_email && org.verified_lead_email_confirmed_at
      ? org.verified_lead_email
      : null

  if (!recipient) {
    console.warn(`${LOG} org=${org.id} has no verified lead notifications email — skipping`)
    return
  }

  const distanceLine =
    distanceMiles !== null
      ? `Distance from your service epicenter: ${distanceMiles.toFixed(2)} miles`
      : 'Distance: unavailable (geofence not configured)'

  // Form-captured leads = paid signals that converted. PII is OK to
  // include here because the merchant already paid for the signal that
  // produced this lead.
  const baseSubject = geofence === 'inside'
    ? `Lead converted — ${fullName}`
    : `Lead captured (outside service area) — ${fullName}`
  const subject = subjectPrefix ? `${subjectPrefix}${baseSubject}` : baseSubject

  const headline = geofence === 'inside'
    ? appointmentAt
      ? 'A prospect just booked an appointment from your landing page.'
      : 'A prospect just submitted your landing page.'
    : 'A prospect submitted your landing page from outside your service area.'

  const apptLine = appointmentAt
    ? `Requested appointment: ${new Date(appointmentAt).toLocaleString()}`
    : 'No appointment was booked (out of service area).'

  const body = [
    headline,
    '',
    `Name:    ${fullName}`,
    `Phone:   ${phone}`,
    distanceLine,
    apptLine,
    '',
    'Open your dashboard to view full details.',
    '',
    '— Kinvox',
  ].join('\n')

  try {
    const client = new ServerClient(token)
    const result = await client.sendEmail({
      From:     'Kinvox <support@kinvoxtech.com>',
      To:       recipient,
      Subject:  subject,
      TextBody: body,
    })
    console.log(`${LOG} dispatched org=${org.id} to=${recipient} geofence=${geofence} appointment=${appointmentAt ? 'yes' : 'no'} postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${org.id} to=${recipient}: ${msg}`)
  }
}

// Confirmation-email dispatch. Used by both the new-lead path and the
// resubmission path. appointmentTime may be null when the booking was
// skipped (out-of-area resubmit) or failed; the rendered template
// collapses to a no-appointment variant in that case.
type LeadConfirmationArgs = {
  org:                     OrgRow
  email:                   string
  firstName:               string
  address:                 string
  phone:                   string
  customAnswersWithLabels: Array<{ label: string; answer: string }>
  appointmentTime:         string | null
  leadDisplayId:           string | null
  leadId:                  string
}

async function dispatchLeadConfirmation(args: LeadConfirmationArgs): Promise<void> {
  const overrideTemplate = args.org.confirmation_email_template
    ? {
        subject: args.org.confirmation_email_template.subject ?? null,
        body:    args.org.confirmation_email_template.body    ?? null,
      }
    : null
  const rendered = renderLeadConfirmationEmail({
    orgName:         args.org.name,
    firstName:       args.firstName || 'there',
    serviceAddress:  args.address,
    phone:           args.phone,
    appointmentTime: args.appointmentTime,
    customAnswers:   args.customAnswersWithLabels,
    leadDisplayId:   args.leadDisplayId,
    override:        overrideTemplate,
  })
  // Reply-To routes the prospect's reply through Postmark's plus-addressed
  // inbound mailbox so it lands in the lead conversation panel via the
  // postmark/inbound webhook. Threading anchor mirrors the ticket pattern
  // (<displayId@kinvox.com>) — synthetic, used as both References and
  // In-Reply-To on every send so Gmail/Outlook keep the thread together.
  const replyTo     = constructInboundEmailAddress(args.org.inbound_lead_email_tag)
  const threadingId = `<${args.leadDisplayId ?? `ld_${args.leadId}`}@kinvox.com>`
  if (!replyTo) {
    console.warn(`[outbound] inbound tag missing for org=${args.org.id} channel=lead — reply-to omitted, customer replies will land in org's verified mailbox and bypass conversation panel`)
  }
  const result = await sendOrgTransactionalEmail({
    org:               args.org,
    to:                args.email,
    subject:           rendered.subject,
    htmlBody:          rendered.htmlBody,
    textBody:          rendered.textBody,
    tag:               'lead-confirmation',
    fromAddressSource: 'lead',
    replyTo:           replyTo ?? undefined,
    headers: [
      { Name: 'References',  Value: threadingId },
      { Name: 'In-Reply-To', Value: threadingId },
    ],
  })
  if (!result.ok) {
    console.error(`[lead-capture] confirmation email failed lead=${args.leadId} org=${args.org.id}: ${result.error}`)
  }
}

// Human-readable system message body appended to lead_messages on resubmission.
// Renders the submitted form fields so the merchant can see exactly what the
// prospect typed this time around. Rendered as a markdown-ish bullet list;
// the conversation panel displays it as plain text inside the "System" badge.
type ResubmissionBodyArgs = {
  isArchived:              boolean
  isDisposed:              boolean
  priorStatus:             string
  trimmedName:             string
  phone:                   string
  address:                 string
  apptIso:                 string
  customAnswersWithLabels: Array<{ label: string; answer: string }>
  homestead:               boolean | null
  geofence:                'inside' | 'outside'
  distanceMiles:           number | null
  appointmentBooked:       boolean
  appointmentInsertFailed: boolean
  apptTitle:               string | null
  apptDisplayId:           string | null
}

function composeResubmissionMessageBody(args: ResubmissionBodyArgs): string {
  const headlineParts: string[] = ['Lead resubmitted the magnet form.']
  if (args.isArchived) {
    headlineParts.push('Auto-restored from Archived.')
  } else if (args.isDisposed) {
    headlineParts.push(`Auto-reopened from status='${args.priorStatus}' to 'new'.`)
  } else {
    headlineParts.push(`Prior status: '${args.priorStatus}'.`)
  }

  const lines: string[] = [headlineParts.join(' '), '', 'Submitted info:']
  lines.push(`• Name: ${args.trimmedName}`)
  lines.push(`• Phone: ${args.phone}`)
  lines.push(`• Address: ${args.address}`)
  lines.push(`• Requested appointment: ${new Date(args.apptIso).toLocaleString()}`)
  lines.push(`• Geofence: ${args.geofence}${args.distanceMiles !== null ? ` (${args.distanceMiles.toFixed(2)} mi)` : ''}`)
  if (args.homestead !== null) {
    lines.push(`• Homestead exemption: ${args.homestead ? 'yes' : 'no'}`)
  }
  if (args.customAnswersWithLabels.length > 0) {
    lines.push('• Custom answers:')
    for (const a of args.customAnswersWithLabels) {
      lines.push(`    – ${a.label}: ${a.answer}`)
    }
  }
  lines.push('')
  if (args.appointmentBooked && args.apptDisplayId) {
    lines.push(`Appointment booked: ${args.apptTitle ?? 'Initial consultation'} on ${new Date(args.apptIso).toLocaleString()}. Reference: ${args.apptDisplayId}`)
  } else if (args.appointmentInsertFailed) {
    lines.push('Appointment booking failed — please follow up manually.')
  } else if (args.geofence === 'outside') {
    lines.push('No appointment was created (visitor is outside service area).')
  }

  return lines.join('\n')
}
