-- SEC-M5: fixed-window rate-limit infrastructure. Backs abuse controls on public anon surfaces
-- (lead capture email-bomb/relay, apply form, password reset). DB-only; app wiring is SEC-M5-2.
-- The atomic single-statement increment (ON CONFLICT ... RETURNING) is REQUIRED to avoid a
-- lost-update race under the exact concurrent-flood threat model this defends against.

create table if not exists public.rate_limits (
  bucket_key   text        not null,
  window_start timestamptz not null,
  count        int         not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

comment on table public.rate_limits is
  'SEC-M5 fixed-window rate-limit counters. One row per (bucket_key, window_start). '
  'Written ONLY via public.check_rate_limit() (SECURITY DEFINER, service_role EXECUTE only); '
  'not directly reachable by anon/authenticated. Stale windows are GC''d hourly by the '
  'rate_limits_cleanup pg_cron job (drops rows older than 2h).';

-- Lock the table down: RLS on, NO anon/authenticated policies (only the SECURITY DEFINER RPC,
-- running as its owner, touches it). Direct PostgREST access by anon/authenticated = denied.
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;

-- Atomic check-and-increment. Returns whether the caller is still under the limit for this window.
-- allowed = (post-increment count <= p_max). The decision is read from the SAME RETURNING — never
-- re-SELECT (that reintroduces the lost-update race).
create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds int,
  p_max int
)
returns table(allowed boolean, current_count int)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_window timestamptz;
  v_count  int;
begin
  -- floor "now" to the start of the current fixed window
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits (bucket_key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
  do update set count = public.rate_limits.count + 1, updated_at = now()
  returning public.rate_limits.count into v_count;

  return query select (v_count <= p_max), v_count;
end;
$function$;

-- Service-role only (callers use createAdminClient). NEVER grant anon/authenticated — that would let
-- an attacker inflate or probe their own counter directly over PostgREST.
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant  execute on function public.check_rate_limit(text, int, int) to service_role;

-- Cleanup: hourly GC of windows older than 2h via pg_cron (installable on this project). Wrapped in a
-- DO/EXCEPTION block so any pg_cron issue cannot roll back the table+RPC above; if scheduling fails,
-- the rows simply accumulate slowly until a cleanup mechanism is added (SEC-M5 follow-up).
do $cleanup$
begin
  execute 'create extension if not exists pg_cron';
  if not exists (select 1 from cron.job where jobname = 'rate_limits_cleanup') then
    perform cron.schedule(
      'rate_limits_cleanup',
      '0 * * * *',
      $cron$delete from public.rate_limits where window_start < now() - interval '2 hours'$cron$
    );
  end if;
exception when others then
  raise warning 'SEC-M5: pg_cron cleanup NOT scheduled (%); rate_limits table+RPC still installed, add GC separately', sqlerrm;
end
$cleanup$;
