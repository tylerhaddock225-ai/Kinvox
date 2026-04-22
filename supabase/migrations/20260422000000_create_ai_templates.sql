-- AI Template library: industry-specific lead-gen prompts that the
-- Platform Owner authors centrally and merchants opt into. Per-merchant
-- feature toggles live in organizations.enabled_ai_features so a single
-- template can be tuned org-by-org without forking the prompt itself.

create table if not exists public.ai_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry    text not null,
  base_prompt text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_ai_templates_updated_at
  before update on public.ai_templates
  for each row execute function public.set_updated_at();

create index if not exists ai_templates_industry_idx
  on public.ai_templates (industry);

alter table public.organizations
  add column if not exists ai_template_id uuid
    references public.ai_templates(id) on delete set null,
  add column if not exists enabled_ai_features jsonb
    not null default '{}'::jsonb;

create index if not exists organizations_ai_template_idx
  on public.organizations (ai_template_id);

alter table public.ai_templates enable row level security;

-- Tenant code may need to load the template assigned to its org so the
-- AI runtime can read base_prompt + metadata.features. Read is open to
-- any authenticated user; writes are gated to platform_owner.
create policy "ai_templates: read authenticated"
  on public.ai_templates
  for select
  to authenticated
  using (true);

create policy "ai_templates: platform_owner full access"
  on public.ai_templates
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and system_role = 'platform_owner'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and system_role = 'platform_owner'
    )
  );

grant all on table public.ai_templates to anon, authenticated, service_role;

-- Seed: Storm Shelter template tuned for the Apr-2026 OK grant cycle.
-- Sooner Safe is unfunded this cycle, so SOH ($10k) is the primary
-- qualifying hook. Homestead exemption is the lead-in question because
-- it's the SOH gating requirement. Features are defined here so the HQ
-- "Feature Library" view and the merchant toggle UI both read from one
-- source of truth.
insert into public.ai_templates (name, industry, base_prompt, metadata)
values (
  'Storm Shelter',
  'Storm Shelter',
  $prompt$You are a lead-qualification assistant for an Oklahoma storm-shelter installer. Your goal is to determine whether the homeowner qualifies for the 2026 Strengthen Oklahoma Homes (SOH) $10,000 grant and to capture installation-feasibility details.

Active grant window: April 2026 — SOH Grant Wave 2. This is the live cycle; do not reference past or upcoming waves.

Open every conversation by confirming the homeowner has a current Oklahoma Homestead Exemption — this is the primary SOH gating requirement and the single biggest disqualifier. If they do not, redirect to financing options rather than the grant track.

Context for the April 2026 / SOH Wave 2 cycle:
- Sooner Safe is unfunded this cycle; do not offer it.
- SOH Wave 2 is the primary $10,000 driver and is administered by the Oklahoma Insurance Department.
- Tribal grants (Chickasaw, Choctaw) may stack with or substitute for SOH for enrolled members.

[[FEATURE:soh_grant_screener]]
SOH Grant Screener — after the homestead exemption is confirmed, walk through the SOH Wave 2 qualifying questions in order: county of residence, year the home was built, whether the homeowner has previously received an SOH award, and the wind-zone rating of the property. Stop and hand off as "SOH-qualified" the moment all four pass.
[[/FEATURE:soh_grant_screener]]

[[FEATURE:virtual_fitment]]
Virtual Fitment — once the lead is interested in installation, request photos of the proposed install location (garage interior, driveway approach, ceiling height reference) and one photo of the home exterior. Confirm minimum clearance of 7 feet for above-ground units and flag any obstructions you can see in the uploads.
[[/FEATURE:virtual_fitment]]

[[FEATURE:tribal_grant_check]]
Tribal Grant Check — if the homeowner mentions tribal enrollment or appears to live within Chickasaw or Choctaw jurisdictional boundaries, ask whether they are an enrolled citizen of either nation. If yes, surface the tribal storm-shelter grant track as either a stack or a substitute for SOH and capture their tribal ID number for follow-up.
[[/FEATURE:tribal_grant_check]]

Stay concise, ask one question at a time, and hand off to a human as soon as the homeowner is qualified or clearly disqualified.$prompt$,
  jsonb_build_object(
    'cycle', '2026-04',
    'features', jsonb_build_array(
      jsonb_build_object(
        'key',         'soh_grant_screener',
        'name',        'SOH Grant Screener',
        'description', 'Qualifies leads for the $10,000 Strengthen Oklahoma Homes grant. Leads with the homestead exemption.',
        'default_enabled', true
      ),
      jsonb_build_object(
        'key',         'virtual_fitment',
        'name',        'Virtual Fitment',
        'description', 'Handles photo uploads of the garage / install site and flags clearance issues before a tech is dispatched.',
        'default_enabled', true
      ),
      jsonb_build_object(
        'key',         'tribal_grant_check',
        'name',        'Tribal Grant Check',
        'description', 'Checks Chickasaw / Choctaw enrollment to surface tribal grant eligibility alongside SOH.',
        'default_enabled', false
      )
    )
  )
)
on conflict do nothing;
