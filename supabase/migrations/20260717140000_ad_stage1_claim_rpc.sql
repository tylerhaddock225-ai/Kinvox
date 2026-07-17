-- WORKSTREAM AD Stage 1 — atomic draft-job claim RPC.
--
-- PostgREST can't express FOR UPDATE SKIP LOCKED, so the drainer claims one
-- pending ai_draft_jobs row through this SECURITY DEFINER function: it flips the
-- oldest pending row to 'processing', bumps attempts, and returns it (0 rows when
-- the queue is empty). SKIP LOCKED lets concurrent drains (fast-path after() kick
-- + the daily cron backstop) run without contending on the same row.
--
-- No behavior change ships: nothing enqueues ai_draft_jobs until AD-2, so the
-- queue is always empty and this function is a no-op in practice today.

begin;

create or replace function public.claim_ai_draft_job()
  returns setof public.ai_draft_jobs
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  update public.ai_draft_jobs
     set status     = 'processing',
         attempts   = attempts + 1,
         updated_at = now()
   where id = (
     select id
       from public.ai_draft_jobs
      where status = 'pending'
      order by created_at
      limit 1
      for update skip locked
   )
  returning *;
end;
$function$;

-- Service-role only (drainer / cron via the admin client) — never anon/authenticated.
revoke execute on function public.claim_ai_draft_job() from public;
revoke execute on function public.claim_ai_draft_job() from anon;
revoke execute on function public.claim_ai_draft_job() from authenticated;
grant  execute on function public.claim_ai_draft_job() to service_role;

commit;
