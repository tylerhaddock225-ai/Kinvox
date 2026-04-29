// Single source of truth for whether an Organization's public lead-magnet
// page is "live" — renderable at /l/[slug] and accepting submissions.
//
// The page is live iff ALL three of these hold:
//
//   1. subscription_status === 'active'
//        Flipped manually in HQ today; a future sprint wires it to Stripe
//        customer.subscription.* and invoice.payment_failed webhooks.
//
//   2. feature_flags.lead_magnet_enabled === true
//        Platform capability switch. Off by default for new orgs; HQ flips
//        it on per pilot.
//
//   3. lead_magnet_settings.enabled === true
//        The org's own toggle in the HQ Lead Capture tab — the closest
//        thing to a tenant-driven kill switch.
//
// Pure, synchronous, no I/O. Defensive on shape: pass nulls or junk and
// it answers false rather than throwing.

export type LeadMagnetGateInput = {
  feature_flags:        Record<string, unknown> | null
  lead_magnet_settings: Record<string, unknown> | null
  subscription_status:  string | null
}

export type LeadMagnetGateReason =
  | 'subscription_inactive'
  | 'feature_flag_off'
  | 'settings_disabled'
  | null

function hasActiveSubscription(status: string | null | undefined): boolean {
  return status === 'active'
}

function hasFeatureFlagOn(flags: Record<string, unknown> | null | undefined): boolean {
  if (!flags || typeof flags !== 'object') return false
  return flags.lead_magnet_enabled === true
}

function hasSettingsEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings || typeof settings !== 'object') return false
  return settings.enabled === true
}

export function isLeadCaptureLive(org: LeadMagnetGateInput): boolean {
  return (
    hasActiveSubscription(org.subscription_status) &&
    hasFeatureFlagOn(org.feature_flags) &&
    hasSettingsEnabled(org.lead_magnet_settings)
  )
}

// Returns the FIRST failing check in the same order as isLeadCaptureLive.
// Used downstream by HQ to render "why is this off" copy. Not wired to any
// UI yet — Step 9 will consume it.
export function getLeadCaptureGateReason(org: LeadMagnetGateInput): LeadMagnetGateReason {
  if (!hasActiveSubscription(org.subscription_status)) return 'subscription_inactive'
  if (!hasFeatureFlagOn(org.feature_flags))            return 'feature_flag_off'
  if (!hasSettingsEnabled(org.lead_magnet_settings))   return 'settings_disabled'
  return null
}
