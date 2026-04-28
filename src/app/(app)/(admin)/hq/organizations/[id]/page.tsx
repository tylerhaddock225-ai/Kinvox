import Link from 'next/link'
import { ArrowLeft, ShieldAlert, Archive, RotateCcw, Sparkles, Megaphone, Mail, CheckCircle2, AlertCircle, Wallet, Radar, MapPin } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  updateOrganization,
  setOrgStatus,
  archiveOrganization,
  restoreOrganization,
  setOrgGeofence,
} from '@/app/(app)/(admin)/admin-hq/actions/organizations'
import { sendOrganizationClaimInvite } from '@/app/(app)/(admin)/admin-hq/actions/claim'
import ConfirmButton from '@/components/admin/ConfirmButton'
import OrgAiStrategyForm from '@/components/admin/OrgAiStrategyForm'
import OrgLeadCaptureForm from '@/components/admin/OrgLeadCaptureForm'
import OrgCreditManager from '@/components/hq/org-credit-manager'
import OrgApiKeyList from '@/components/hq/org-api-key-list'
import OrgSignalConfigs from '@/components/hq/org-signal-configs'
import OrgCaptureToggle from '@/components/admin/OrgCaptureToggle'
import type { AiTemplate } from '@/lib/ai-templates'
import type {
  OrganizationCredits,
  OrganizationApiKey,
  SignalConfig,
  Vertical,
} from '@/lib/types/database.types'

type TabKey = 'details' | 'lead-capture' | 'signal-configs' | 'integrations-billing'
const TABS: Array<{ key: TabKey; label: string; icon: typeof Sparkles }> = [
  { key: 'details',              label: 'Details',               icon: Sparkles },
  { key: 'lead-capture',         label: 'Lead Capture',          icon: Megaphone },
  { key: 'signal-configs',       label: 'Signal Configs',        icon: Radar },
  { key: 'integrations-billing', label: 'Integrations & Billing', icon: Wallet },
]

// Base URL the preview link + embed snippet should use. NEXT_PUBLIC_APP_URL
// is set per-environment in Vercel; the fallback points at the prod host
// so a missing var on prod doesn't silently leak sandbox URLs into the HQ
// UI (local dev already sets the var explicitly in its .env).
const LANDING_BASE =
  (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com').replace(/\/$/, '')

export const dynamic = 'force-dynamic'

const PLANS: Array<{ value: 'free' | 'pro' | 'enterprise'; label: string }> = [
  { value: 'free',       label: 'Free' },
  { value: 'pro',        label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
]

export default async function AdminOrgDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>
  searchParams: Promise<{
    tab?:             string
    error?:           string
    claim_sent?:      string
    claim_error?:     string
    credits_added?:   string
    credits_error?:   string
    topup_saved?:     string
    new_key?:         string
    key_error?:       string
    key_revoked?:     string
    config_saved?:    string
    config_error?:    string
    geofence_saved?:  string
    geofence_error?:  string
  }>
}) {
  const { id } = await params
  const sp     = await searchParams
  const activeTab: TabKey =
    sp.tab === 'lead-capture'         ? 'lead-capture' :
    sp.tab === 'signal-configs'       ? 'signal-configs' :
    sp.tab === 'integrations-billing' ? 'integrations-billing' :
                                        'details'
  const errorMessage = typeof sp.error === 'string' ? sp.error : null
  const claimSentTo  = typeof sp.claim_sent  === 'string' ? sp.claim_sent  : null
  const claimError   = typeof sp.claim_error === 'string' ? sp.claim_error : null

  const creditsAdded = typeof sp.credits_added === 'string' ? parseInt(sp.credits_added, 10) : null
  const creditsError = typeof sp.credits_error === 'string' ? sp.credits_error               : null
  const topUpSaved   = sp.topup_saved === '1'
  const newKey       = typeof sp.new_key    === 'string' ? sp.new_key    : null
  const keyError     = typeof sp.key_error  === 'string' ? sp.key_error  : null
  const keyRevoked   = sp.key_revoked === '1'
  const configSaved  = sp.config_saved === '1'
  const configError  = typeof sp.config_error === 'string' ? sp.config_error : null
  const geofenceSaved = sp.geofence_saved === '1'
  const geofenceError = typeof sp.geofence_error === 'string' ? sp.geofence_error : null
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug, vertical, status, plan, deleted_at, created_at, owner_id, ai_template_id, enabled_ai_features, ai_listening_enabled, lead_magnet_slug, lead_magnet_settings, website_url, latitude, longitude, signal_radius')
    .eq('id', id)
    .single<{
      id:                    string
      name:                  string
      slug:                  string | null
      vertical:              string | null
      status:                string | null
      plan:                  string | null
      deleted_at:            string | null
      created_at:            string
      owner_id:              string
      ai_template_id:        string | null
      enabled_ai_features:   Record<string, boolean> | null
      ai_listening_enabled:  boolean
      lead_magnet_slug:      string | null
      lead_magnet_settings:  { enabled?: boolean; headline?: string; features?: string[] } | null
      website_url:           string | null
      latitude:              number | null
      longitude:             number | null
      signal_radius:         number | null
    }>()

  if (!org) notFound()

  const [{ data: templates }, { data: verticals }] = await Promise.all([
    supabase
      .from('ai_templates')
      .select('id, name, industry, base_prompt, metadata')
      .order('name', { ascending: true })
      .returns<AiTemplate[]>(),
    supabase
      .from('verticals')
      .select('id, label, is_active')
      .eq('is_active', true)
      .order('label', { ascending: true })
      .returns<Vertical[]>(),
  ])

  const verticalOptions: Vertical[] = verticals ?? []

  // Only load tab-specific data when that tab is active — keeps the
  // happy-path details view from paying for round-trips the user did
  // not ask for.
  let credits: OrganizationCredits | null = null
  let apiKeys: OrganizationApiKey[] = []
  let signalConfigs: SignalConfig[] = []
  if (activeTab === 'integrations-billing') {
    const [{ data: c }, { data: k }] = await Promise.all([
      supabase
        .from('organization_credits')
        .select('id, organization_id, balance, auto_top_up_enabled, top_up_threshold, top_up_amount, created_at, updated_at')
        .eq('organization_id', org.id)
        .maybeSingle<OrganizationCredits>(),
      supabase
        .from('organization_api_keys')
        .select('id, organization_id, key_hash, label, created_by, last_used_at, revoked_at, created_at')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
        .returns<OrganizationApiKey[]>(),
    ])
    credits = c ?? null
    apiKeys = k ?? []
  } else if (activeTab === 'signal-configs') {
    const { data: configs } = await supabase
      .from('signal_configs')
      .select('id, organization_id, vertical, center_lat, center_long, radius_miles, keywords, is_active, created_at')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .returns<SignalConfig[]>()
    signalConfigs = configs ?? []
  }

  const isArchived = !!org.deleted_at
  const status     = (org.status ?? 'active').toLowerCase()
  const isActive   = status === 'active'

  return (
    <div className="space-y-8 max-w-3xl">
      <Link
        href="/admin-hq/organizations"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All organizations
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] text-violet-300 uppercase">
            Managing Organization
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-white">{org.name}</h1>
          <p className="mt-1 text-xs text-gray-500 font-mono">{org.slug ?? '—'} · {org.id}</p>
        </div>
        {isArchived && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/60 bg-amber-950/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-amber-300">
            <Archive className="w-3 h-3" />
            Archived
          </span>
        )}
      </header>

      {/* Tab nav */}
      <nav className="flex items-center gap-1 border-b border-pvx-border">
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = key === activeTab
          const href = key === 'details'
            ? `/admin-hq/organizations/${org.id}`
            : `/admin-hq/organizations/${org.id}?tab=${key}`
          return (
            <Link
              key={key}
              href={href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                active
                  ? 'text-violet-200 border-violet-500'
                  : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-pvx-border'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          )
        })}
      </nav>

      {activeTab === 'details' && <>
      {/* Status toggle */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-gray-400">Status</div>
            <div className="mt-1">
              {isArchived ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-pvx-border bg-pvx-surface px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  Archived
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                  <span className={`text-sm font-medium ${isActive ? 'text-emerald-300' : 'text-gray-400'}`}>
                    {status}
                  </span>
                </div>
              )}
            </div>
            {isArchived && (
              <p className="mt-2 text-[11px] text-gray-500">
                Toggle disabled while archived. Restore the organization below to re-enable.
              </p>
            )}
          </div>
          <form action={setOrgStatus}>
            <input type="hidden" name="id"     value={org.id} />
            <input type="hidden" name="status" value={isActive ? 'inactive' : 'active'} />
            <button
              type="submit"
              disabled={isArchived}
              aria-disabled={isArchived}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                isArchived
                  ? 'border-pvx-border bg-pvx-surface text-gray-600 cursor-not-allowed opacity-60'
                  : isActive
                    ? 'border-amber-700/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
                    : 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'
              }`}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
          </form>
        </div>
      </section>

      {/* Edit form */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <h2 className="text-sm font-semibold text-white">Details</h2>
        <p className="mt-1 text-xs text-gray-500">Updates apply platform-wide and are visible to the organization.</p>

        <form action={updateOrganization} className="mt-5 space-y-4">
          <input type="hidden" name="id" value={org.id} />

          <Field label="Organization Name">
            <input
              name="name"
              defaultValue={org.name}
              required
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </Field>

          <Field label="Vertical">
            <select
              name="vertical"
              defaultValue={org.vertical ?? ''}
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            >
              <option value="">— Unassigned —</option>
              {verticalOptions.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Subscription Plan">
            <select
              name="plan"
              defaultValue={(org.plan ?? 'free').toLowerCase()}
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            >
              {PLANS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              Save changes
            </button>
          </div>
        </form>
      </section>

      {/* Geofence */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">Organization Geofence</h2>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Anchor coordinates + radius scoping incoming signals. Mirrored in the tenant&apos;s Settings page.
        </p>

        {geofenceSaved && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Geofence saved.</span>
          </div>
        )}
        {geofenceError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{geofenceError}</span>
          </div>
        )}

        <form action={setOrgGeofence} className="mt-5 space-y-4">
          <input type="hidden" name="id" value={org.id} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Latitude">
              <input
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={org.latitude ?? ''}
                placeholder="35.4676"
                className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
              />
            </Field>
            <Field label="Longitude">
              <input
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={org.longitude ?? ''}
                placeholder="-97.5164"
                className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
              />
            </Field>
          </div>

          <Field label="Signal Radius (miles)">
            <input
              name="signal_radius"
              type="number"
              step="1"
              min={1}
              max={500}
              required
              defaultValue={org.signal_radius ?? 25}
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </Field>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              Save Geofence
            </button>
          </div>
        </form>
      </section>

      {/* AI Strategy */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">AI Strategy</h2>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Pick the prompt template this organization runs and toggle individual features on or off.
        </p>

        <div className="mt-5">
          <OrgAiStrategyForm
            orgId={org.id}
            templates={templates ?? []}
            currentTemplateId={org.ai_template_id}
            enabledFeatures={org.enabled_ai_features ?? {}}
          />
        </div>
      </section>

      {/* Merchant claim invite */}
      <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-violet-300" />
          <h2 className="text-sm font-semibold text-white">Send Claim Invite</h2>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Emails a 7-day claim link to the organization owner. On redemption they become the owner of this organization and get tenant-admin access.
        </p>

        {claimSentTo && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Claim invite sent to <span className="font-mono">{claimSentTo}</span>. Link expires in 7 days.</span>
          </div>
        )}
        {claimError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{claimError}</span>
          </div>
        )}

        <form action={sendOrganizationClaimInvite} className="mt-5 space-y-3">
          <input type="hidden" name="org_id" value={org.id} />
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
              Recipient email
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="owner@example.com"
              className="w-full rounded-md bg-pvx-surface border border-pvx-border px-3 py-2 text-sm text-gray-100 font-mono focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-500 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Send claim invite
          </button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-400" />
          <h2 className="text-sm font-semibold text-rose-200">Danger Zone</h2>
        </div>

        {!isArchived ? (
          <>
            <p className="mt-2 text-xs text-rose-300/70">
              Archiving hides this organization from their workspace and blocks new logins.
              The row is preserved and can be restored.
            </p>
            <form action={archiveOrganization} className="mt-4">
              <input type="hidden" name="id" value={org.id} />
              <ConfirmButton
                message={`Archive "${org.name}"? Organization members will lose access until restored.`}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-700/60 bg-rose-900/30 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/50 transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive organization
              </ConfirmButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-rose-300/70">
              This organization is currently archived. Restoring re-enables access.
            </p>
            <form action={restoreOrganization} className="mt-4">
              <input type="hidden" name="id" value={org.id} />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/40 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore organization
              </button>
            </form>
          </>
        )}
      </section>
      </>}

      {activeTab === 'lead-capture' && (
        <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">Lead Capture</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Configure this organization's public lead-magnet landing page and copy the embed snippet for their website.
          </p>

          <div className="mt-5">
            <OrgLeadCaptureForm
              orgId={org.id}
              slug={org.lead_magnet_slug}
              settings={org.lead_magnet_settings}
              websiteUrl={org.website_url}
              landingBase={LANDING_BASE}
              errorMessage={errorMessage}
            />
          </div>
        </section>
      )}

      {activeTab === 'signal-configs' && (
        <section className="rounded-xl border border-pvx-border bg-gray-900 p-5 space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold text-white">Signal Configs</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Geofence + keyword configs routed by <span className="font-mono">/api/v1/signals/capture</span>. A signal must match at least one active config for this org to land in the review queue.
            </p>
          </div>

          <OrgCaptureToggle
            orgId={org.id}
            initialEnabled={org.ai_listening_enabled}
          />

          <OrgSignalConfigs
            orgId={org.id}
            configs={signalConfigs}
            verticals={verticalOptions}
            flash={{ saved: configSaved, error: configError }}
          />
        </section>
      )}

      {activeTab === 'integrations-billing' && (
        <>
          <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold text-white">Credits</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Signal balance and ledger adjustments for this organization. Every change writes to <span className="font-mono">credit_ledger</span>.
            </p>

            <div className="mt-5">
              {credits ? (
                <OrgCreditManager
                  orgId={org.id}
                  credits={{
                    balance:             credits.balance,
                    auto_top_up_enabled: credits.auto_top_up_enabled,
                    top_up_threshold:    credits.top_up_threshold,
                    top_up_amount:       credits.top_up_amount,
                  }}
                  flash={{
                    creditsAdded: creditsAdded,
                    topUpSaved:   topUpSaved,
                    error:        creditsError,
                  }}
                />
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>No credits row for this organization yet — the provisioning trigger should backfill on next DB sync.</span>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-pvx-border bg-gray-900 p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold text-white">Signal API Keys</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Keys authenticate external agents (Make.com, n8n) calling <span className="font-mono">POST /api/v1/signals/capture</span>. Raw keys are shown once at creation and never re-displayed.
            </p>

            <div className="mt-5">
              <OrgApiKeyList
                orgId={org.id}
                keys={apiKeys}
                flash={{
                  newKey:  newKey,
                  revoked: keyRevoked,
                  error:   keyError,
                }}
              />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-gray-400 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  )
}
