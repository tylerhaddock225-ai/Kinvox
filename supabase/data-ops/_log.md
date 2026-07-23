# Data Ops Run Log

Append-only. Each row records a single `scripts/run-data-op.mjs` execution.

| Timestamp (UTC) | Env | File | Operator | Outcome |
|---|---|---|---|---|
| 2026-05-13 (pre-Workstream-D, recorded retroactively) | prod | 20260513000000_nuke_prod_test_orgs.sql | tyler | ok (3 verifications passed) |
| 2026-05-13 (pre-Workstream-D, recorded retroactively) | prod | 20260513120000_backfill_kinvox_demo_support_tag.sql | tyler | ok |
| 2026-05-08 (pre-Workstream-D, recorded retroactively) | sandbox | 20260508000000_backfill_inbound_tags_sandbox.sql | tyler | ok |
| 2026-05-08 (pre-Workstream-D, recorded retroactively) | prod | 20260508000000_backfill_inbound_tags_sandbox.sql | tyler | no-op (slug not present on prod) |

> Rows below this line are auto-appended by `scripts/run-data-op.mjs`.
| 2026-05-22 14:53:12Z | sandbox | 20260522095244_create_lead_email_profiles_and_backfill.sql | ahjab | FAILED (exit null) |
| 2026-05-22 15:00:04Z | sandbox | 20260522095244_create_lead_email_profiles_and_backfill.sql | ahjab | FAILED (exit null) |
| 2026-05-22 15:03:31Z | sandbox | 20260522095244_create_lead_email_profiles_and_backfill.sql | ahjab | FAILED (exit null) |
| 2026-05-22 15:03:48Z | sandbox | 20260522095244_create_lead_email_profiles_and_backfill.sql | ahjab | ok |
| 2026-05-22 19:00:04Z | sandbox | 20260522135944_relocate_misfiled_appointments.sql | ahjab | ok |
| 2026-05-22 19:52:19Z | sandbox | 20260522145204_normalize_dual_linked_appointments.sql | ahjab | ok |
| 2026-05-26 20:29:12Z | prod | 20260522145204_normalize_dual_linked_appointments.sql | ahjab | ok |
| 2026-05-26 20:31:07Z | prod | 20260522095244_create_lead_email_profiles_and_backfill.sql | ahjab | ok |
| 2026-05-26 20:31:25Z | prod | 20260522135944_relocate_misfiled_appointments.sql | ahjab | ok |
| 2026-06-25 15:13:37Z | sandbox | 20260625000000_m_stage1_decouple_and_delete_hq_org.sql | ahjab | ok |

> **2026-06-25 — M Stage 1 (sandbox only).** File: `sandbox/20260625000000_m_stage1_decouple_and_delete_hq_org.sql`.
> Purpose: decouple Tyler HQ account (platform_owner) from the dead-weight `kinvox-sandbox-hq` org, then delete that org
> (cascade removes bot profile, 2 roles, 2 tickets, 3 appointments, 12 pending_signals, 1 organization_credits) plus the
> orphaned `lead-inbox+kinvox-sandbox-hq@kinvox.internal` bot auth.users row. Decouple ran before the delete so the
> ON DELETE CASCADE on `profiles.organization_id` did not remove the platform_owner profile. All transaction guards passed;
> post-op verification confirmed org gone, Tyler HQ intact + decoupled, zero dual-positive profiles, bot auth row gone,
> Niko's org untouched. **PROD IS NOT YET SYNCED** — this op has only been applied to sandbox.
| 2026-06-25 19:31:57Z | prod | 20260625140000_m_stage1_decouple_hq_prod.sql | ahjab | ok |

> **2026-06-25 — M prod Stage 1 (PRODUCTION, decouple-only).** File: `prod/20260625140000_m_stage1_decouple_hq_prod.sql`.
> Purpose: null the HQ account's (`tyler@kinvoxtech.com`, `2ef26c2e-…`, platform_owner) `organization_id` so prod's
> dual_positive_count goes 1 → 0 (required before the Stage 3 `profiles_no_dual_positive` constraint can VALIDATE in Turn 3).
> **DIVERGES from sandbox:** prod's only org, `Kinvox Demo Org` (`aaaaaaaa-…0001`, slug `kinvox-demo`), is **intentionally
> RETAINED** — it is a populated demo org (8 customers, 9 leads, 9 tickets, 2 demo users + lead-inbox bot), NOT empty litter
> like the sandbox `kinvox-sandbox-hq` org that was deleted. No deletes, no bot cleanup, no org deletion on prod. All
> transaction guards passed; post-op verified: dual_positive=0, Tyler intact + decoupled (org_id NULL), demo org present
> with customers=8/leads=9 unchanged. Linked to prod for the op, then **relinked back to sandbox**.
> **STILL PENDING for prod:** migrations `20260625120000` + `20260625130000` (Turn 3) and code merge to `main` (Turn 4).
| 2026-07-17 21:09:56Z | sandbox | 20260717150000_enable_autodraft_niko_sandbox.sql | ahjab | ok (1 row; ai_drafting_mode manual→auto_draft) |

> **2026-07-17 — AD Stage 2 sandbox test enablement (SANDBOX ONLY).** File: `sandbox/20260717150000_enable_autodraft_niko_sandbox.sql`.
> Purpose: flip Niko's Storm Protection (`6fe9db41-…`) to `ai_drafting_mode='auto_draft'` so inbound customer messages
> auto-generate drafts for Tyler's live test of AD Stage 2. Applied via the **Management API** (sandbox ref
> `ntwimeqxyyvjyrisqofl`), NOT `run-data-op.mjs` — the Supabase CLI can't run non-interactively here (no DB password).
> Post-op gate state verified: `ai_drafting_mode=auto_draft`, `ai_support_enabled=true`, `ai_template_id=7b7f21ca-…`,
> `organization_credits.balance=16` → full auto-draft gate passes. Sandbox only; no-op on prod (different org id there).
| 2026-06-30 15:41:02Z | prod | 20260630140000_k2c_remediate_alex_org_admin.sql | ahjab | ok |

> **2026-06-30 — K2c Stage A prod prerequisite (PRODUCTION).** File: `prod/20260630140000_k2c_remediate_alex_org_admin.sql`.
> Purpose: remediate the one fallback-dependent prod user before the Stage A RLS migration removes the `role='admin'`
> back-compat. Alex Admin (`admin@kinvox-demo.com`, `bbbbbbbb-…-001`) is Kinvox Demo Org's `owner_id` (NOT NULL FK →
> cannot be deleted), and authorized only via the legacy fallback (`role_id` NULL). Assigned him the demo org's existing
> system "Org Admin" role (`ddaff626…`, full 19-key bag) so he authorizes via the permission bag instead. Non-destructive:
> `owner_id` untouched, Sam Agent (`role='agent'`, not a fallback user) untouched, no other rows touched. All transaction
> guards passed; post-op verified: Alex `role_id=ddaff626…` with manage_org_settings/manage_roles/manage_team=true, and
> the fallback-dependent-users count = 0 (the invariant Stage A's RLS removal requires). Linked to prod for the op, then
> relinked back to sandbox. Migrations `20260630120000` (B) + `20260630130000` (A) pushed to prod immediately after.
| 2026-07-21 15:00:00Z | sandbox | 20260721130000_set_niko_sandbox_sms_numbers.sql | ahjab | ok (1 row; sms_support_number → +17372324091) |

> **2026-07-21 — SMS-1 sandbox test enablement (SANDBOX ONLY).** File: `sandbox/20260721130000_set_niko_sandbox_sms_numbers.sql`.
> Purpose: give Niko's Storm Protection (`6fe9db41-…`) an SMS support sending number (`+17372324091`, the Twilio trial
> number) so Tyler can live-test the ticket-reply SMS toggle. `sms_lead_number` left NULL (lead rail is a later stage;
> trial account has one number). Applied via the **Management API** (sandbox ref `ntwimeqxyyvjyrisqofl`), NOT
> `run-data-op.mjs` — the Supabase CLI can't run `db query` non-interactively here (no DB password), same constraint as
> the AD Stage 2 op above. Transaction-guarded; post-op verified: `sms_support_number=+17372324091`, `sms_lead_number=NULL`,
> and exactly 1 org holds the number (partial-unique-index sanity). Sandbox only; NO-OP on prod (different org id there).
| 2026-07-23 (SMS-2b) | sandbox | 20260723110000_normalize_phones_e164_sandbox.sql | ahjab | ok (customers_updated=0, leads_updated=19) |

> **2026-07-23 — SMS-2b phone E.164 backfill (SANDBOX ONLY).** File: `sandbox/20260723110000_normalize_phones_e164_sandbox.sql`.
> Purpose: normalize existing `customers.phone` + `leads.phone` to E.164 so the SMS inbound rail's exact-phone match can
> route pre-SMS-0 rows. Simple SQL algo (strip non-digits; 10→'+1'||d; 11 leading '1'→'+'||d; else untouched) — NOT
> libphonenumber. Applied via the **Management API** (sandbox ref `ntwimeqxyyvjyrisqofl`). Dry-run first, then applied:
> **customers 0 changed** (both non-null already E.164), **leads 19 changed** (dry-run matched exactly). Post-op verified:
> 0 parseable-but-unnormalized rows remain; lead phones now `{+12143647795, +14055550199, 555}` — `555` correctly left
> untouched (unparseable). Idempotent (re-run = 0 rows). Sandbox only.
>
> **2026-07-23 — SMS-2b rail-swap pair (PREPARED, NOT APPLIED).** Files:
> `sandbox/20260723120000_swap_niko_sms_support_to_lead.sql` (A: support→lead) and
> `sandbox/20260723120100_swap_niko_sms_lead_to_support.sql` (B: revert lead→support). The Twilio trial account has ONE
> number (`+17372324091`), currently on Niko's SUPPORT rail. To live-test the LEAD-rail SMS toggle + lead inbound webhook,
> run A (moves the number to the lead column in one atomic guarded UPDATE), test, then run B to restore. **Neither has been
> applied** — sandbox `sms_lead_number` stays NULL until Tyler requests the lead-rail test. Sandbox only.
