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
    .select('id, name, owner_id, latitude, longitude, signal_radius, lead_magnet_settings, deleted_at, verified_support_email, verified_support_email_confirmed_at')
    .ilike('lead_magnet_slug', slug)
    .is('deleted_at', null)
    .maybeSingle<OrgRow>()

  if (orgErr) return { status: 'error', error: 'Lookup failed' }
  if (!org)   return { status: 'error', error: 'This landing page is not available' }
  if (!org.lead_magnet_settings?.enabled) {
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

  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      organization_id: org.id,
      first_name:      firstName || 'Unknown',
      last_name:       lastName,
      email,
      phone,
      status:          'new',
      source:          'web',
      metadata,
    })
    .select('id')
    .single<{ id: string }>()

  if (insertErr) {
    // Unique violation on (org, email): treat as idempotent success so
    // double-submits / bots don't surface a scary error to the visitor.
    if (insertErr.code === '23505') return { status: 'success' }
    return { status: 'error', error: 'Submission failed — please try again.' }
  }

  // Appointment booking: only for in-area visitors. The created_by FK
  // requires a real auth user — we use the org's owner since the booking
  // is being made on the org's behalf, not by an individual employee.
  // Zero-Inference: org.id and org.owner_id come from the slug lookup,
  // never from the form payload.
  let appointmentBooked = false
  if (geofence === 'inside' && lead?.id) {
    const { error: apptErr } = await supabase
      .from('appointments')
      .insert({
        organization_id: org.id,
        lead_id:         lead.id,
        created_by:      org.owner_id,
        title:           `Initial consultation — ${trimmedName}`,
        description:     `Booked from ${slug} lead magnet. Service address: ${address}`,
        start_at:        apptIso,
        status:          'scheduled',
      })

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
    }
  }

  // Notification: tells the merchant about the conversion. Sprint 3 copy:
  // form-captured leads are confirmed conversions, not paywall teasers,
  // so the email is celebratory + actionable, not a unlock-CTA.
  await sendLeadAlertEmail({
    org,
    geofence,
    distanceMiles,
    fullName: trimmedName,
    phone,
    appointmentAt: appointmentBooked ? apptIso : null,
  })

  return { status: 'success' }
}

type LeadAlertArgs = {
  org:           OrgRow
  geofence:      'inside' | 'outside'
  distanceMiles: number | null
  fullName:      string
  phone:         string
  appointmentAt: string | null
}

async function sendLeadAlertEmail({
  org,
  geofence,
  distanceMiles,
  fullName,
  phone,
  appointmentAt,
}: LeadAlertArgs): Promise<void> {
  const LOG = '[lead-alert]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — skipping alert for org=${org.id}`)
    return
  }

  const recipient =
    org.verified_support_email && org.verified_support_email_confirmed_at
      ? org.verified_support_email
      : null

  if (!recipient) {
    console.warn(`${LOG} org=${org.id} has no verified support email — skipping`)
    return
  }

  const distanceLine =
    distanceMiles !== null
      ? `Distance from your service epicenter: ${distanceMiles.toFixed(2)} miles`
      : 'Distance: unavailable (geofence not configured)'

  // Form-captured leads = paid signals that converted. PII is OK to
  // include here because the merchant already paid for the signal that
  // produced this lead.
  const subject = geofence === 'inside'
    ? `Lead converted — ${fullName}`
    : `Lead captured (outside service area) — ${fullName}`

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
