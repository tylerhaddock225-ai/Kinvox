-- Kinvox — Lead conversation messages.
--
-- Parallel to ticket_messages but scoped to a lead (and used to drive the
-- unified Conversation panel on the lead detail page). Two message kinds:
--   - 'public_reply'  — emails the lead via Postmark and threads inbound
--                       replies via the [ld_<display_id>] subject tag.
--   - 'internal_note' — org-only, replaces the existing lead_activities-
--                       backed Add Note UI.
-- Three author kinds:
--   - 'org_user' — populated when an Organization member writes.
--   - 'lead'     — populated when an inbound webhook routes a reply in.
--   - 'system'   — reserved for future automation entries.

create table if not exists public.lead_messages (
  id                  uuid        primary key default gen_random_uuid(),
  lead_id             uuid        not null references public.leads(id)         on delete cascade,
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  message_type        text        not null check (message_type in ('public_reply', 'internal_note')),
  author_kind         text        not null check (author_kind  in ('org_user', 'lead', 'system')),
  author_user_id      uuid        references public.profiles(id),
  body                text        not null,
  postmark_message_id text,
  inbound_email_from  text,
  created_at          timestamptz not null default now()
);

create index if not exists lead_messages_lead_created_idx
  on public.lead_messages (lead_id, created_at);

create index if not exists lead_messages_org_created_idx
  on public.lead_messages (organization_id, created_at);

comment on table  public.lead_messages is
  'Unified conversation thread for a lead: public email replies + internal notes. '
  'Mirrors ticket_messages; routed by [ld_<display_id>] subject tag.';
comment on column public.lead_messages.message_type is
  'public_reply = visible to the lead (emailed via Postmark or received inbound). '
  'internal_note = org-only.';
comment on column public.lead_messages.author_kind is
  'org_user = an authenticated Organization member; lead = inbound webhook from the lead; system = automation.';
comment on column public.lead_messages.postmark_message_id is
  'Postmark MessageID for outbound public_reply rows AND the external MessageID '
  'from inbound webhook payloads. Helpful for cross-referencing Postmark Activity.';
comment on column public.lead_messages.inbound_email_from is
  'From header of an inbound payload — only populated when author_kind = ''lead''.';

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.lead_messages enable row level security;

-- SELECT: org members of the lead's organization, plus HQ admins. Mirrors
-- the "Admins can view all" policy on ticket_messages.
drop policy if exists "lead_messages: select" on public.lead_messages;
create policy "lead_messages: select"
  on public.lead_messages
  for select
  to authenticated
  using (
    public.is_admin_hq()
    or organization_id = public.auth_user_org_id()
  );

-- INSERT (org_user path): authenticated user, author_user_id must match
-- auth.uid() AND organization_id must match the caller's profile org.
-- Inbound (author_kind='lead') uses the service-role webhook and bypasses
-- RLS, same pattern as ticket_messages inbound.
drop policy if exists "lead_messages: insert org_user" on public.lead_messages;
create policy "lead_messages: insert org_user"
  on public.lead_messages
  for insert
  to authenticated
  with check (
    author_kind    = 'org_user'
    and author_user_id = auth.uid()
    and organization_id in (
      select profiles.organization_id from public.profiles where profiles.id = auth.uid()
    )
  );

-- DELETE: authors can delete their own org_user messages (parity with
-- the "Authors can delete their own ticket messages" policy).
drop policy if exists "lead_messages: delete own" on public.lead_messages;
create policy "lead_messages: delete own"
  on public.lead_messages
  for delete
  using (author_user_id = auth.uid());


-- ── Backfill existing internal notes from lead_activities ─────────────
--
-- lead_activities.user_id is nullable; rows where it's null still backfill
-- as 'org_user' per the spec — author_user_id stays null. We do NOT drop
-- the lead_activities table here; cleanup is a follow-up after the new
-- surface has been verified.
insert into public.lead_messages (
  id,
  lead_id,
  organization_id,
  message_type,
  author_kind,
  author_user_id,
  body,
  created_at
)
select
  a.id,
  a.lead_id,
  l.organization_id,
  'internal_note',
  'org_user',
  a.user_id,
  a.content,
  a.created_at
from public.lead_activities a
join public.leads l on l.id = a.lead_id
on conflict (id) do nothing;
