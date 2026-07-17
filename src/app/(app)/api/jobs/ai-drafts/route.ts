import { NextResponse, type NextRequest } from 'next/server'
import { drainDraftJobs } from '@/lib/ai/auto-draft'

// AD Stage 1 — the auto-draft queue drainer, exposed as an endpoint.
//
// Trigger model (Vercel HOBBY plan caps cron at once/day):
//   * FAST PATH (primary, AD-2): the inbound webhook kicks this via next/server
//     after() right after it enqueues, so drafts appear within seconds.
//   * BACKSTOP: a single daily Vercel Cron (GET, see vercel.json) sweeps any
//     stragglers the fast path missed. On the Pro plan, tighten that schedule.
//
// Auth: Authorization: Bearer ${CRON_SECRET}. Vercel Cron sends this header when
// CRON_SECRET is set as a project env var; the after()/manual path sends it too.
// This route is exempted from the session login gate in @/lib/supabase/session,
// so the Bearer check here is the ONLY gate.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LOG = '[ai-drafts-cron]'

function authorize(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error(`${LOG} CRON_SECRET is not set — refusing to run`)
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null  // authorized
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request)
  if (denied) return denied

  const summary = await drainDraftJobs(10)
  console.log(`${LOG} drained`, summary)
  return NextResponse.json({ ok: true, ...summary }, { status: 200 })
}

// Vercel Cron issues GET; the after() fast-path kick and manual triggers use POST.
export async function GET(request: NextRequest):  Promise<NextResponse> { return handle(request) }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request) }
