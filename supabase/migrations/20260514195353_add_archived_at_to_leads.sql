BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.leads.archived_at IS
  'Soft-archive timestamp. Archived leads are hidden from the active leads list but preserved in the database. Email is freed for resubmission (handled by capture-action restoring the lead on match). Restore action sets this back to null.';

CREATE INDEX IF NOT EXISTS leads_org_archived_idx
  ON public.leads (organization_id, archived_at)
  WHERE archived_at IS NOT NULL;

COMMIT;
