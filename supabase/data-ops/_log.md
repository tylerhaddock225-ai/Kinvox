# Data Ops Run Log

Append-only. Each row records a single `scripts/run-data-op.mjs` execution.

| Timestamp (UTC) | Env | File | Operator | Outcome |
|---|---|---|---|---|
| 2026-05-13 (pre-Workstream-D, recorded retroactively) | prod | 20260513000000_nuke_prod_test_orgs.sql | tyler | ok (3 verifications passed) |
| 2026-05-13 (pre-Workstream-D, recorded retroactively) | prod | 20260513120000_backfill_kinvox_demo_support_tag.sql | tyler | ok |
| 2026-05-08 (pre-Workstream-D, recorded retroactively) | sandbox | 20260508000000_backfill_inbound_tags_sandbox.sql | tyler | ok |
| 2026-05-08 (pre-Workstream-D, recorded retroactively) | prod | 20260508000000_backfill_inbound_tags_sandbox.sql | tyler | no-op (slug not present on prod) |

> Rows below this line are auto-appended by `scripts/run-data-op.mjs`.
