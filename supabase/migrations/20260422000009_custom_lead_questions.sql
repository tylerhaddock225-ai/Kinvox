-- Kinvox — Custom Lead Questionnaire per Organization
--
-- JSONB column on organizations. Expected shape (enforced in app code):
--   [
--     { "id": "q_<uuid>", "label": "Preferred contact time?", "required": true }
--   ]
--
-- Name/Email/Phone are the locked, always-mandatory fields on the public
-- landing form — these are rendered by the form template itself and are
-- NOT stored in this column. Only truly-custom additions go here.

alter table public.organizations
  add column if not exists custom_lead_questions jsonb not null default '[]'::jsonb;

-- Guardrail against malformed writes sneaking past app validation: the
-- column must always be a JSON array. NULL is disallowed by NOT NULL
-- already; this adds the array-shape invariant.
alter table public.organizations
  drop constraint if exists organizations_custom_lead_questions_is_array;

alter table public.organizations
  add constraint organizations_custom_lead_questions_is_array
  check (jsonb_typeof(custom_lead_questions) = 'array');
