// SMS consent audit notes — SMS Stage 2b (Part 5).
//
// Records a human-readable system entry on a LEAD's conversation thread when its
// SMS consent state changes (public opt-in via the emailed link, or an org-side
// manual toggle). Uses lead_messages author_kind='system' (author_user_id null) —
// the rail's first-class automation-authored message kind.
//
// CUSTOMER rail intentionally has NO equivalent: customer_activities.user_id is
// NOT NULL (no system-author affordance) and the public confirm path is
// unauthenticated, so a consent note there would either be impossible or would
// misattribute an audit event to a real user's notes feed. Skipped by design.
//
// Requires the service-role admin client: the lead_messages RLS insert policy
// only permits author_kind='org_user' rows whose author_user_id = auth.uid(),
// so a system-authored row must bypass RLS. Fail-open — a missing audit note
// must never sink the consent write that already succeeded.

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export async function logLeadSmsSystemNote(
  admin: ReturnType<typeof createAdminClient>,
  args: { leadId: string; orgId: string; body: string },
): Promise<void> {
  const { error } = await admin.from('lead_messages').insert({
    lead_id:         args.leadId,
    organization_id: args.orgId,
    message_type:    'internal_note',
    author_kind:     'system',
    author_user_id:  null,
    body:            args.body,
  })
  if (error) {
    console.error(`[sms-consent-note] insert failed lead=${args.leadId}: ${error.message}`)
  }
}
