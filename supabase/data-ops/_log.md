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
