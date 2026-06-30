-- Workstream W1 (Ownerless Orgs) Stage 2 — make organizations.owner_id optional.
--
-- An org may now exist without an owner (e.g. after the owner's account is
-- deleted). Stage 1 (W1-1, code-only) already repointed every path that wrote
-- created_by = owner_id to author via the per-org lead-inbox bot, so no code path
-- requires a non-null owner_id anymore; this flip is safe.
--
-- Two changes:
--   1. DROP NOT NULL on owner_id — ownerless orgs are now valid.
--   2. FK -> ON DELETE SET NULL — deleting an owner's profile auto-nulls owner_id
--      (the org survives, ownerless) instead of the prior NO ACTION/RESTRICT that
--      blocked the delete. Everything else of the FK is preserved exactly as the
--      live definition: REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED.
--
-- No data backfill: every existing row has a non-null owner and stays valid; NULL
-- is only reachable going forward (owner deletion). The created_by paths that used
-- to depend on the owner now author via the lead-inbox bot (W1-1).

begin;

alter table public.organizations alter column owner_id drop not null;

-- Recreate the FK with ON DELETE SET NULL; constraint name + REFERENCES target +
-- DEFERRABLE INITIALLY DEFERRED preserved exactly from the live definition.
alter table public.organizations drop constraint organizations_owner_id_fkey;
alter table public.organizations add constraint organizations_owner_id_fkey
  foreign key (owner_id) references public.profiles(id)
  on delete set null
  deferrable initially deferred;

commit;
