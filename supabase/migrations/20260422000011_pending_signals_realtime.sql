-- Kinvox — Realtime for the pending_signals review queue.
-- Adds the table to supabase_realtime so the tenant's Signals tab pops
-- on INSERT/UPDATE. Idempotent guard mirrors the leads publication add
-- from 20260422000006.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname    = 'supabase_realtime'
          and schemaname = 'public'
          and tablename  = 'pending_signals'
     )
  then
    execute 'alter publication supabase_realtime add table public.pending_signals';
  end if;
end $$;
