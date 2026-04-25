'use server'

// Public lead-magnet capture — server action variant.
//
// Pay-on-Unlock model:
//   1. Geocodes the visitor's "Service Address" via lib/geo.ts.
//   2. Compares the resulting point against the org's saved epicenter +
//      signal_radius to decide qualified vs out_of_bounds.
//   3. Persists the lead with status='pending_unlock' regardless of
//      qualification — the merchant pays per-unlock from the dashboard,
//      not at capture time. PII is stored but masked in the leads UI
//      until unlocked.
//   4. NO credits are deducted at capture. Billing happens via the
//      unlockLead server action; reference_id on the resulting ledger
//      row will be this lead's id.
//
// Zero-Inference: organization_id is resolved server-side from the slug
// embedded in the form. Anything the client claims about org id/coords/
// fence is ignored.

import { ServerClient } from 'postmark'
import { createAdminClient } from '@/lib/supabase/admin'
import { geocodeAddress, haversineMiles } from '@/lib/geo'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEASER_CHARS = 20

export type CaptureLeadState =
  | { status: 'success' }
  | { status: 'error'; error: string }
  | null

type OrgRow = {
  id:                                  string
  name:                                string
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
  const slug    = String(formData.get('slug')    ?? '').trim().toLowerCase()
  const name    = String(formData.get('name')    ?? '').trim()
  const email   = String(formData.get('email')   ?? '').trim().toLowerCase()
  const phone   = String(formData.get('phone')   ?? '').trim()
  const address = String(formData.get('address') ?? '').trim()

  if (!slug)                 return { status: 'error', error: 'Missing slug' }
  if (!name)                 return { status: 'error', error: 'Name is required' }
  if (!EMAIL_RE.test(email)) return { status: 'error', error: 'Enter a valid email address' }
  if (!phone)                return { status: 'error', error: 'Phone is required' }
  if (!address)              return { status: 'error', error: 'Service address is required' }

  // Service-role: anonymous public submission. We re-resolve the slug here
  // and never trust an organization_id from the form payload (Zero-Inference).
  const supabase = createAdminClient()

  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, latitude, longitude, signal_radius, lead_magnet_settings, deleted_at, verified_support_email, verified_support_email_confirmed_at')
    .ilike('lead_magnet_slug', slug)
    .is('deleted_at', null)
    .maybeSingle<OrgRow>()

  if (orgErr) return { status: 'error', error: 'Lookup failed' }
  if (!org)   return { status: 'error', error: 'This landing page is not available' }
  if (!org.lead_magnet_settings?.enabled) {
    return { status: 'error', error: 'This landing page is not available' }
  }

  // Geofence is only meaningful when the org has fully configured an anchor +
  // radius. If any piece is missing we treat the submission as qualified —
  // the merchant still gets the lead and decides whether to unlock it.
  let geofence: 'inside' | 'outside' = 'inside'
  let distanceMiles: number | null   = null
  let qualified = true

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
    qualified = distanceMiles <= org.signal_radius
    geofence  = qualified ? 'inside' : 'outside'
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

  // Teaser snippet: first 20 chars of the joined custom answers, stripped
  // of newlines. Renders in the locked dashboard row so the merchant has
  // *some* qualitative signal to weigh against the unlock cost.
  const teaserSnippet = customAnswers.length
    ? customAnswers
        .map((a) => a.answer)
        .join(' · ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TEASER_CHARS)
    : null

  const metadata: Record<string, unknown> = {
    captured_via: 'lead_magnet',
    slug,
    address,
    geofence,
    qualified,
    tags:         ['lead_magnet'],
  }
  if (distanceMiles !== null) metadata.distance_miles      = Number(distanceMiles.toFixed(2))
  if (homesteadRaw   !== null) metadata.homestead_exemption = homestead
  if (customAnswers.length)    metadata.custom_answers      = customAnswers
  if (teaserSnippet)           metadata.teaser_snippet      = teaserSnippet

  const { error: insertErr } = await supabase
    .from('leads')
    .insert({
      organization_id: org.id,
      first_name:      firstName || 'Unknown',
      last_name:       lastName,
      email,
      phone,
      status:          'pending_unlock',
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

  // Speed-to-Lead alert. Pay-on-Unlock means the email no longer claims
  // a credit was deducted — it nudges the merchant to open the dashboard
  // and unlock the lead there.
  await sendLeadAlertEmail({
    org,
    geofence,
    distanceMiles,
  })

  return { status: 'success' }
}

type LeadAlertArgs = {
  org:           OrgRow
  geofence:      'inside' | 'outside'
  distanceMiles: number | null
}

async function sendLeadAlertEmail({
  org,
  geofence,
  distanceMiles,
}: LeadAlertArgs): Promise<void> {
  const LOG = '[lead-alert]'

  const token = process.env.POSTMARK_SERVER_TOKEN
  if (!token) {
    console.error(`${LOG} POSTMARK_SERVER_TOKEN not set — skipping alert for org=${org.id}`)
    return
  }

  // Recipient: only the org's verified support address. Unconfirmed
  // addresses would be rejected by Postmark anyway, and we don't want
  // the merchant inadvertently spamming a typo-d email they entered.
  const recipient =
    org.verified_support_email && org.verified_support_email_confirmed_at
      ? org.verified_support_email
      : null

  if (!recipient) {
    console.warn(`${LOG} org=${org.id} has no verified support email — skipping`)
    return
  }

  // Pay-on-Unlock: PII (name, phone, address) is intentionally NOT in the
  // email. Including it here would defeat the unlock paywall — anyone with
  // mailbox access would have the contact details for free. The email's
  // job is to drive the merchant back into the dashboard.
  const distanceLine =
    distanceMiles !== null
      ? `Distance from your service epicenter: ${distanceMiles.toFixed(2)} miles`
      : 'Distance: unavailable (geofence not configured)'

  const subject  = 'New Signal Captured — Unlock in Dashboard'
  const headline = geofence === 'inside'
    ? 'A new lead landed inside your service area.'
    : 'A new lead landed — outside your service area.'

  const body = [
    headline,
    '',
    `Geofence: ${geofence === 'inside' ? 'IN service area' : 'OUTSIDE service area'}`,
    distanceLine,
    '',
    'Open your dashboard to review and unlock this lead (1 credit).',
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
    console.log(`${LOG} dispatched org=${org.id} to=${recipient} geofence=${geofence} postmark_id=${result.MessageID}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`${LOG} FAILED org=${org.id} to=${recipient}: ${msg}`)
    // Swallow — the lead is captured. Email is best-effort; merchants
    // can also see the lead in their dashboard.
  }
}
