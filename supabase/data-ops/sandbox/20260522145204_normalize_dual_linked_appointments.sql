-- Normalize appointments that carry BOTH lead_id and customer_id.
-- resolveCustomerLink() prior to this commit auto-populated lead_id from
-- customer.lead_id when a customer was selected, creating rows that
-- violated the "leads and customers are separate rails" principle.
-- Customer-linked appointments are canonically on the support rail;
-- NULL out lead_id and keep customer_id.

SELECT 'Dual-linked appointments before normalization' AS metric,
       COUNT(*)::text AS value
FROM public.appointments
WHERE lead_id IS NOT NULL AND customer_id IS NOT NULL;

UPDATE public.appointments
SET lead_id    = NULL,
    updated_at = now()
WHERE lead_id IS NOT NULL AND customer_id IS NOT NULL;

SELECT 'Dual-linked appointments after normalization' AS metric,
       COUNT(*)::text AS value
FROM public.appointments
WHERE lead_id IS NOT NULL AND customer_id IS NOT NULL;
