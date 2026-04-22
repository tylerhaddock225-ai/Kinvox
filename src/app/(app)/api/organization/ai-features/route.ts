// Resolved AI feature flags for the calling merchant. The lead-capture
// widget and any other client surface that needs to know "do I show the
// photo upload? the tribal-grant prompt?" should hit this endpoint.
//
// Auth: standard merchant session cookie. We never accept an org_id from
// the caller — the answer is always for the org on the JWT, which keeps
// one merchant from probing another's flags.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAiPromptForOrg } from '@/lib/ai-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single<{ organization_id: string | null }>()

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'no organization' }, { status: 403 })
  }

  const resolved = await resolveAiPromptForOrg(profile.organization_id)

  // Public-safe payload only. Never leak the resolved base prompt — that's
  // template IP and stays server-side. Widget UIs only need the boolean
  // flags + the human-readable feature catalogue to build their UI.
  return NextResponse.json({
    organization_id: resolved.organization_id,
    template: resolved.template
      ? { id: resolved.template.id, name: resolved.template.name, industry: resolved.template.industry }
      : null,
    enabled:  resolved.enabled,
    features: resolved.features.map((f) => ({
      key:         f.key,
      name:        f.name,
      description: f.description,
      enabled:     !!resolved.enabled[f.key],
    })),
    // Convenience aliases for the lead-capture widget so it doesn't have
    // to know feature keys verbatim. Add new ones here as new features land.
    flags: {
      showPhotoUpload:        !!resolved.enabled['virtual_fitment'],
      showSohScreener:        !!resolved.enabled['soh_grant_screener'],
      showTribalGrantCheck:   !!resolved.enabled['tribal_grant_check'],
    },
  })
}
