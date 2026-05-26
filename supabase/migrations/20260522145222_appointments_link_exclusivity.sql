-- Enforce: an appointment can be linked to a customer OR a lead, never
-- both. Aligns the schema with the "leads and customers are completely
-- separate communication rails" principle. Defense-in-depth against the
-- resolveCustomerLink auto-derive bug that produced dual-linked rows
-- prior to this commit. Existing dual-linked rows were normalized in
-- the corresponding data-op (NULL'd lead_id, kept customer_id).

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_link_exclusivity
  CHECK (lead_id IS NULL OR customer_id IS NULL);
