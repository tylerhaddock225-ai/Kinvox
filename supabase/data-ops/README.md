# Data Ops

Environment-specific data mutations live here. **Not** schema. **Not** tracked by the Supabase CLI.

## Why a separate folder

`supabase/migrations/` is watched by `supabase db push --linked`. Files in that folder run on every environment, in tracker order. That's correct for schema (CREATE TABLE, ALTER, indexes, policies) but wrong for env-specific data work (deleting prod test orgs, backfilling a single org's columns by slug).

Putting env-specific data ops in `migrations/` previously required manual `supabase migration repair --status applied` against the non-target environment to lie to the CLI tracker. That dance is now eliminated: data ops live here, the CLI never sees them, no repair needed.

## Layout

- `prod/` — runs against production only
- `sandbox/` — runs against sandbox only
- `shared/` — runs against both (rare; usually reference-data backfills that happen to need both envs)

## How to run

Use `scripts/run-data-op.mjs`. Never run a `.sql` file from this folder by hand.

    node --env-file=.env.local scripts/run-data-op.mjs <env> <filename>

    # Examples
    node --env-file=.env.local scripts/run-data-op.mjs prod 20260513000000_nuke_prod_test_orgs.sql
    node --env-file=.env.local scripts/run-data-op.mjs sandbox 20260508000000_backfill_inbound_tags_sandbox.sql

The wrapper:
1. Verifies the file exists in `supabase/data-ops/<env>/` (refuses if it's in a different env's folder)
2. Verifies the current Supabase CLI link matches the requested env (refuses on mismatch — protects against running a prod op while linked to sandbox)
3. Executes the SQL via `npx supabase db query --linked`
4. Appends a run record to `supabase/data-ops/_log.md`

After running, commit the updated `_log.md` so the audit trail is in git history.

## Historical note — moved-out files

The following files used to live in `supabase/migrations/` but were moved here as part of Workstream D (May 15, 2026). Their Supabase CLI tracker entries on both sandbox and prod were left in place — the work was already done; only the file location changed.

| Original timestamp | New location | Notes |
|---|---|---|
| `20260508000000_backfill_inbound_tags_sandbox.sql` | `sandbox/` | Sandbox-only backfill of Niko's Storm Protection inbound tags. No-op on prod (filename suffix `_sandbox` reflects actual scope). |
| `20260513000000_nuke_prod_test_orgs.sql` | `prod/` | One-time hard-delete of 4 legacy test orgs. Would have RAISE'd on sandbox; was tracker-repaired previously. |
| `20260513120000_backfill_kinvox_demo_support_tag.sql` | `prod/` | One-time backfill of Kinvox Demo Org's support tag to the post-Phase-A1 convention. Would have RAISE'd on sandbox; was tracker-repaired previously. |

If you grep for these timestamps and don't see them in `migrations/`, this is why.
