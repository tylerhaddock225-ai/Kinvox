-- ============================================================
-- Migration: Ticket messages (conversation thread) + status/priority
--            enum tightening.
-- Run in Supabase → SQL Editor.
-- ============================================================


-- ── 1. Tighten ticket status / priority enums ───────────────────────────────
-- Existing schema allows status in (open, pending, resolved, closed) and
-- priority in (low, medium, high, urgent). The product spec narrows these
-- to (open, pending, closed) and (low, medium, high). Map retired values
-- onto the nearest surviving value before swapping the check constraint.

update public.tickets set status   = 'closed' where status   = 'resolved';
update public.tickets set priority = 'high'   where priority = 'urgent';

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets
  add constraint tickets_status_check
  check (status in ('open', 'pending', 'closed'));

alter table public.tickets drop constraint if exists tickets_priority_check;
alter table public.tickets
  add constraint tickets_priority_check
  check (priority in ('low', 'medium', 'high'));


-- ── 2. ticket_messages table ────────────────────────────────────────────────

create table if not exists public.ticket_messages (
  id         uuid        primary key default gen_random_uuid(),
  ticket_id  uuid        not null
                         references public.tickets(id) on delete cascade,
  sender_id  uuid
                         references public.profiles(id) on delete set null,
  body       text        not null,
  type       text        not null default 'public'
                         check (type in ('public', 'internal')),
  created_at timestamptz not null default now()
);


-- ── 3. Indexes ──────────────────────────────────────────────────────────────

create index if not exists ticket_messages_ticket_created_idx
  on public.ticket_messages(ticket_id, created_at asc);


-- ── 4. RLS ──────────────────────────────────────────────────────────────────

alter table public.ticket_messages enable row level security;

create policy "Org members can view ticket messages"
  on public.ticket_messages for select
  using (
    ticket_id in (
      select t.id from public.tickets t
      where t.organization_id in (
        select organization_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "Org members can insert ticket messages"
  on public.ticket_messages for insert
  with check (
    sender_id = auth.uid()
    and ticket_id in (
      select t.id from public.tickets t
      where t.organization_id in (
        select organization_id from public.profiles where id = auth.uid()
      )
    )
  );

create policy "Authors can delete their own ticket messages"
  on public.ticket_messages for delete
  using (sender_id = auth.uid());
