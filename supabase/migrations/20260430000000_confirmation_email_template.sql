-- Kinvox — Per-organization customer-confirmation email template override.
--
-- Sprint 3 Phase A introduces a customer-facing confirmation email sent
-- after lead capture. Orgs ship with the Kinvox-provided default; this
-- column lets a Kinvox operator (and, in a later sprint, the org itself)
-- override the subject and/or body. Either subfield null means "use the
-- Kinvox default for that part". Column itself null means "use defaults
-- entirely".

alter table public.organizations
  add column if not exists confirmation_email_template jsonb;

comment on column public.organizations.confirmation_email_template is
  'Per-org override of the customer confirmation email sent after lead '
  'capture. Shape: { subject: string | null, body: string | null }. Either '
  'field null means use the Kinvox default. Column itself null means use '
  'defaults entirely. Editing UI is deferred to a later sprint; until then, '
  'orgs ship with defaults and Kinvox can set this directly during '
  'white-glove onboarding if needed.';
