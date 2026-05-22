-- Add pseudo-agent inbox flags to profiles
ALTER TABLE public.profiles
  ADD COLUMN is_org_inbox boolean NOT NULL DEFAULT false,
  ADD COLUMN org_inbox_kind text;

-- Enforce: org_inbox_kind required iff is_org_inbox = true
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_org_inbox_kind_consistency
  CHECK (
    (is_org_inbox = false AND org_inbox_kind IS NULL)
    OR
    (is_org_inbox = true AND org_inbox_kind IN ('lead'))
  );

-- One inbox of each kind per organization
CREATE UNIQUE INDEX profiles_org_inbox_unique
  ON public.profiles (organization_id, org_inbox_kind)
  WHERE is_org_inbox = true;

-- Standard lookup index
CREATE INDEX profiles_org_inbox_lookup
  ON public.profiles (organization_id)
  WHERE is_org_inbox = true;

COMMENT ON COLUMN public.profiles.is_org_inbox IS 'True when this profile is a pseudo-agent inbox owned by the org (e.g., Lead Email). Routes email via org settings, not auth.users.email.';
COMMENT ON COLUMN public.profiles.org_inbox_kind IS 'Discriminator for inbox type. Currently only ''lead''. Future: ''support''.';
