-- ============================================================
-- Migration: Backfill organizations.inbound_email_address for any
-- existing rows that don't have one yet.
--
-- Mirrors the JS helper in src/lib/org-utils.ts:
--   slug(org.name) + '-' + 4-char base32-ish hash + '@inbound.kinvoxtech.com'
-- so addresses generated here look identical to ones created via the UI.
--
-- Idempotent: skips orgs that already have an address.
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── Helper: slugify an org name ────────────────────────────────────────────

create or replace function public._kinvox_slugify(input text)
returns text language sql immutable as $$
  select coalesce(
    nullif(
      substring(
        regexp_replace(
          regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'),
          '(^-+)|(-+$)', '', 'g'
        )
        from 1 for 32
      ),
      ''
    ),
    'org'
  );
$$;


-- ── Helper: short hash matching the JS HASH_ALPHABET (no 0/o/1/l) ──────────

create or replace function public._kinvox_short_hash(len int default 4)
returns text language plpgsql volatile as $$
declare
  alphabet text := 'abcdefghijkmnpqrstuvwxyz23456789';
  out      text := '';
  i        int;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;


-- ── Backfill loop ─────────────────────────────────────────────────────────

do $$
declare
  r          record;
  candidate  text;
  attempt    int;
  domain     text := 'inbound.kinvoxtech.com';
begin
  for r in
    select id, name from public.organizations where inbound_email_address is null
  loop
    attempt := 0;
    loop
      attempt := attempt + 1;
      candidate := public._kinvox_slugify(r.name) || '-'
                || public._kinvox_short_hash(4) || '@' || domain;

      begin
        update public.organizations
           set inbound_email_address = candidate
         where id = r.id
           and inbound_email_address is null;
        exit;  -- success
      exception
        when unique_violation then
          if attempt >= 8 then
            raise exception 'Could not allocate inbound address for org % after % attempts', r.id, attempt;
          end if;
          -- loop again with a fresh hash
      end;
    end loop;
  end loop;
end $$;


-- Helpers were one-shot scaffolding; drop them so they don't linger.
drop function if exists public._kinvox_short_hash(int);
drop function if exists public._kinvox_slugify(text);
