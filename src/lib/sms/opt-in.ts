// SMS consent (opt-in) primitives — SMS Stage 2a.
//
// The SMS rail is consent-gated: a person is email-only until they opt in, and
// opt-in is recorded with a timestamp (TCPA / A2P posture). This module owns the
// public opt-in link lifecycle for BOTH customer-facing rails (customers + leads):
//   * mintSmsOptInToken   — mint a single-purpose token, store it on the row, and
//     return the public URL to drop into a confirmation email.
//   * resolveSmsOptInToken — resolve a live token back to its row for the public
//     opt-in page (org name + phone on file + current consent state).
//   * confirmSmsOptIn     — consume the token: record consent + timestamp, null
//     the token, optionally correct the stored phone.
//
// All DB work uses the service-role admin client: the public opt-in page + confirm
// action are unauthenticated (no session), and sms_opt_in_token has no RLS SELECT
// path. NOTHING here sends an SMS — delivery arrives in a later stage.

import 'server-only'
import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeToE164 } from '@/lib/phone'

export type OptInKind = 'customer' | 'lead'

// kind → table. The two rails are structurally identical for consent, so one
// code path serves both; this map is the only place the rail name maps to a table.
const TABLE_FOR_KIND: Record<OptInKind, 'customers' | 'leads'> = {
  customer: 'customers',
  lead:     'leads',
}

export function isOptInKind(value: string): value is OptInKind {
  return value === 'customer' || value === 'lead'
}

// 32 bytes → 64 hex chars. URL-safe, high-entropy, single-purpose.
const TOKEN_BYTES = 32

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.kinvoxtech.com').replace(/\/$/, '')
}

function optInUrl(kind: OptInKind, token: string): string {
  return `${appBaseUrl()}/sms-opt-in/${kind}/${token}`
}

/**
 * Mint a single-purpose opt-in token for a row, store it, and return the public
 * opt-in URL. Only mints when the row is NOT already opted in (an opted-in person
 * needs no link). Re-minting overwrites any prior unused token. Best-effort:
 * returns null (never throws) when the row is missing, already opted in, or the
 * store fails — the caller (a confirmation-email sender) treats null as "send the
 * email without the SMS link".
 */
export async function mintSmsOptInToken(kind: OptInKind, id: string): Promise<string | null> {
  const LOG = '[sms-opt-in]'
  const table = TABLE_FOR_KIND[kind]
  try {
    const admin = createAdminClient()

    // Skip if already opted in — a live token on an already-consented row is noise.
    const { data: row, error: readErr } = await admin
      .from(table)
      .select('id, sms_opt_in')
      .eq('id', id)
      .maybeSingle<{ id: string; sms_opt_in: boolean | null }>()
    if (readErr || !row) {
      console.warn(`${LOG} mint skipped — ${kind} ${id} not found${readErr ? `: ${readErr.message}` : ''}`)
      return null
    }
    if (row.sms_opt_in) return null

    const token = randomBytes(TOKEN_BYTES).toString('hex')
    const { error: updErr } = await admin
      .from(table)
      .update({ sms_opt_in_token: token })
      .eq('id', id)
    if (updErr) {
      console.error(`${LOG} token store failed ${kind}=${id}: ${updErr.message}`)
      return null
    }
    return optInUrl(kind, token)
  } catch (err) {
    console.error(`${LOG} mint threw ${kind}=${id}:`, err)
    return null
  }
}

export type ResolvedOptIn = {
  kind:            OptInKind
  id:              string
  orgName:         string
  // Canonical E.164 phone on file, or null when the row has no parseable phone
  // (the opt-in page then asks the person to supply one).
  phoneE164:       string | null
  // Already opted in? (Manual toggle may have consented after the link was minted.)
  alreadyOptedIn:  boolean
}

/**
 * Resolve a live opt-in token to its row for the public opt-in page. Exact match
 * on the raw token; a consumed (nulled) token simply doesn't match → null, which
 * the page renders as a neutral "link no longer valid" (no existence leak).
 */
export async function resolveSmsOptInToken(kind: OptInKind, token: string): Promise<ResolvedOptIn | null> {
  const table = TABLE_FOR_KIND[kind]
  const admin = createAdminClient()

  // Resolve the row, then the org name in a second query. Deliberately NOT a
  // PostgREST embed — the codebase has been bitten by dual-FK embed ambiguity
  // (PGRST201) before, and a two-query lookup on a rare public page is cheap.
  const { data, error } = await admin
    .from(table)
    .select('id, phone, sms_opt_in, organization_id')
    .eq('sms_opt_in_token', token)
    .maybeSingle<{
      id:              string
      phone:           string | null
      sms_opt_in:      boolean | null
      organization_id: string
    }>()
  if (error || !data) return null

  const { data: org } = await admin
    .from('organizations')
    .select('name')
    .eq('id', data.organization_id)
    .maybeSingle<{ name: string }>()

  return {
    kind,
    id:             data.id,
    orgName:        org?.name ?? 'this organization',
    phoneE164:      data.phone ? normalizeToE164(data.phone) : null,
    alreadyOptedIn: Boolean(data.sms_opt_in),
  }
}

export type ConfirmOptInResult =
  | { ok: true;  phoneE164: string }
  | { ok: false; error: 'link_invalid' | 'phone_required' | 'store_failed' }

/**
 * Consume an opt-in token: record consent (sms_opt_in=true, sms_opted_in_at=now),
 * null the token, and — when the person supplied/corrected a number — store the
 * normalized phone. Idempotent: a token that already resolved to an opted-in row
 * still returns ok (the row is consented; the token is cleared). `suppliedPhone`
 * is the raw value from the page's phone input (empty when a number was on file).
 */
export async function confirmSmsOptIn(
  kind: OptInKind,
  token: string,
  suppliedPhone: string,
): Promise<ConfirmOptInResult> {
  const LOG = '[sms-opt-in]'
  const table = TABLE_FOR_KIND[kind]
  const admin = createAdminClient()

  const { data: row, error: readErr } = await admin
    .from(table)
    .select('id, phone')
    .eq('sms_opt_in_token', token)
    .maybeSingle<{ id: string; phone: string | null }>()
  if (readErr || !row) return { ok: false, error: 'link_invalid' }

  // Resolve the number to store: a supplied/corrected value wins (normalized);
  // otherwise the number already on file. Either way the result must be a valid
  // E.164 or we can't opt them into SMS.
  const suppliedE164 = suppliedPhone.trim() ? normalizeToE164(suppliedPhone) : null
  const existingE164 = row.phone ? normalizeToE164(row.phone) : null
  const phoneE164    = suppliedE164 ?? existingE164
  if (!phoneE164) return { ok: false, error: 'phone_required' }

  const { error: updErr } = await admin
    .from(table)
    .update({
      phone:            phoneE164,
      sms_opt_in:       true,
      sms_opted_in_at:  new Date().toISOString(),
      sms_opt_in_token: null,
    })
    .eq('id', row.id)
  if (updErr) {
    console.error(`${LOG} confirm store failed ${kind}=${row.id}: ${updErr.message}`)
    return { ok: false, error: 'store_failed' }
  }

  console.log(`${LOG} consent recorded ${kind}=${row.id}`)
  return { ok: true, phoneE164 }
}
