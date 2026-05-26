-- Workstream F Hotfix #4 prod sync: normalize 2 dual-linked appointments
-- on Kinvox Demo Org so the appointments_link_exclusivity CHECK
-- constraint can apply cleanly.
--
-- Both rows are matched_conversion (customers.lead_id = appointments.lead_id),
-- so dropping the redundant lead_id pointer loses no information — the
-- conversion is preserved on customers.lead_id.
--
-- Per manifest principle ("customer link is the canonical support-rail
-- anchor"), mirroring the sandbox normalization done in commit ca723ce.

-- Pre-check: confirm both rows still exist and are still dual-linked
SELECT id, display_id, lead_id, customer_id
FROM public.appointments
WHERE id IN (
  '5d44dfc7-4266-4272-b58a-4705eec87b54',
  '249178e4-e2fd-4075-9db3-dc8219d98780'
)
ORDER BY id;

-- Normalize: NULL lead_id, keep customer_id
UPDATE public.appointments
SET lead_id = NULL,
    updated_at = now()
WHERE id IN (
  '5d44dfc7-4266-4272-b58a-4705eec87b54',  -- ap_3 Discovery Call, kinvox-demo
  '249178e4-e2fd-4075-9db3-dc8219d98780'   -- ap_1 "Yes", kinvox-demo
);

-- Verification
SELECT COUNT(*) AS remaining_dual_linked
FROM public.appointments
WHERE lead_id IS NOT NULL AND customer_id IS NOT NULL;
-- expected: 0
