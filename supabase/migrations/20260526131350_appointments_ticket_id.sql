-- Workstream F Hotfix #6: dual-rail appointment reply threading.
-- Adds appointments.ticket_id so customer-rail appointment confirmation
-- replies can thread into a stable support ticket (rather than creating
-- a new ticket on every reply, the prior Path C interim behavior).
--
-- Rail invariants:
--   lead-rail:     lead_id populated, customer_id null, ticket_id null
--   customer-rail: customer_id populated, lead_id null, ticket_id optional
--   orphan:        all three null
-- The link-exclusivity constraint is widened to allow customer_id and
-- ticket_id together while still forbidding lead_id with either, since
-- lead-rail and customer-rail are separate communication rails (per
-- manifest's "leads and customers are completely separate" principle).

ALTER TABLE public.appointments
  ADD COLUMN ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;

CREATE INDEX appointments_ticket_id_idx
  ON public.appointments (ticket_id)
  WHERE ticket_id IS NOT NULL;

-- Drop and replace the prior link-exclusivity CHECK (which forbade
-- both lead_id and customer_id) with a rail-aware version.
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_link_exclusivity;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_link_exclusivity CHECK (
    (lead_id IS NULL OR (customer_id IS NULL AND ticket_id IS NULL))
  );

COMMENT ON COLUMN public.appointments.ticket_id IS
  'Optional support-rail ticket link. When set, customer-rail
   appointment confirmation replies thread into this ticket via the
   inbound webhook''s Path B. Backfilled by webhook on first reply when
   unset at appointment creation time. Workstream G will add explicit
   selection at creation time. Forbidden on lead-rail rows (CHECK
   constraint).';
