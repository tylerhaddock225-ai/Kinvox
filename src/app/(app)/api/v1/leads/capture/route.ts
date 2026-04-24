// Public lead-magnet capture endpoint.
//
// Called from the anonymous landing page at /l/[slug]. We re-resolve the
// slug server-side (never trust the organization_id from the caller) and
// insert via the service-role admin client so anonymous callers can
// create leads without widening the leads-table RLS. The tradeoff: this
// endpoint is rate-limit-worthy and the server is the sole gatekeeper.

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type CustomAnswer = {
  question_id?: unknown
  label?:       unknown
  answer?:      unknown
}

type Payload = {
  slug?:                string
  name?:                string
  email?:               string
  phone?:               string
  address?:             string
  homestead_exemption?: boolean | null
  custom_answers?:      CustomAnswer[]
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  let body: Payload
  try {
    body = await request.json() as Payload
  } catch {
    return bad('Invalid JSON body')
  }

  const slug    = typeof body.slug  === 'string' ? body.slug.trim().toLowerCase() : ''
  const name    = typeof body.name  === 'string' ? body.name.trim()                : ''
  const email   = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const phone   = typeof body.phone === 'string' ? body.phone.trim()               : ''
  const address = typeof body.address === 'string' ? body.address.trim()           : ''

  if (!slug)                 return bad('Missing slug')
  if (!name)                 return bad('Name is required')
  if (!EMAIL_RE.test(email)) return bad('Enter a valid email address')
  if (!phone)                return bad('Phone is required')

  const supabase = createAdminClient()

  // Re-resolve the slug server-side. Anyone could POST a different slug
  // than the page they're on, so we trust only the DB's view of enabled
  // landing pages.
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, lead_magnet_settings, deleted_at')
    .ilike('lead_magnet_slug', slug)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; lead_magnet_settings: { enabled?: boolean } | null; deleted_at: string | null }>()

  if (orgErr) return bad(`Resolver failed: ${orgErr.message}`, 500)
  if (!org)   return bad('This landing page is not available', 404)
  if (!org.lead_magnet_settings?.enabled) return bad('This landing page is not available', 404)

  // Crude name split — first token is first_name, remainder is last_name.
  // Good enough for a capture form; merchants can clean up downstream.
  const trimmed  = name.replace(/\s+/g, ' ')
  const spaceIdx = trimmed.indexOf(' ')
  const firstName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
  const lastName  = spaceIdx === -1 ? null    : trimmed.slice(spaceIdx + 1)

  const metadata: Record<string, unknown> = {
    captured_via: 'lead_magnet',
    slug,
    tags: ['lead_magnet'],
  }
  if (address)                       metadata.address = address
  if (typeof body.homestead_exemption === 'boolean') {
    metadata.homestead_exemption = body.homestead_exemption
  }

  // Server-side scrub of tenant-defined answers. We accept whatever the
  // public form sent but only persist clean strings — never trust the
  // client about which questions were "required" (the form's HTML5
  // validation does that; server just records what arrived).
  if (Array.isArray(body.custom_answers) && body.custom_answers.length > 0) {
    const cleaned = body.custom_answers
      .map((a) => ({
        question_id: typeof a?.question_id === 'string' ? a.question_id.slice(0, 64)  : '',
        label:       typeof a?.label       === 'string' ? a.label.slice(0, 200)       : '',
        answer:      typeof a?.answer      === 'string' ? a.answer.trim().slice(0, 2000) : '',
      }))
      .filter((a) => a.question_id && a.label && a.answer)
      .slice(0, 20)
    if (cleaned.length > 0) metadata.custom_answers = cleaned
  }

  const { data: lead, error: insertErr } = await supabase
    .from('leads')
    .insert({
      organization_id: org.id,
      first_name:      firstName || 'Unknown',
      last_name:       lastName,
      email,
      phone:           phone || null,
      status:          'new',
      source:          'web',
      metadata,
    })
    .select('id, display_id')
    .single<{ id: string; display_id: string | null }>()

  if (insertErr) {
    // Unique violation on (org, email) → treat as idempotent success so
    // bots / double-clicks don't surface a scary error to the visitor.
    if (insertErr.code === '23505') {
      return NextResponse.json({ ok: true, idempotent: true })
    }
    return bad(`Insert failed: ${insertErr.message}`, 500)
  }

  return NextResponse.json({ ok: true, lead_id: lead?.id, display_id: lead?.display_id })
}
