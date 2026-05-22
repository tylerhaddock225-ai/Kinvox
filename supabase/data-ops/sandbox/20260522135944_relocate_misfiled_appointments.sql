-- Relocate appointments where appointments.organization_id does not match
-- the assigned_to profile's organization_id. This is the signature of a
-- mis-filed appointment created via the dashboard server action while an
-- HQ admin was impersonating a tenant — the row was inserted under the
-- HQ admin's own org id rather than the tenant's. createAppointment was
-- patched in the same commit to use resolveEffectiveOrgId, preventing
-- future occurrences.
--
-- The relocation rule is precise: only rows where the assignee profile
-- has a known organization_id that differs from the appointment's. Rows
-- with null assigned_to or null profile.organization_id are not touched.

-- Preview first: count and list candidates
SELECT 'Mis-filed appointments (count)' AS metric,
       COUNT(*)::text AS value
FROM public.appointments a
JOIN public.profiles p ON p.id = a.assigned_to
WHERE p.organization_id IS NOT NULL
  AND a.organization_id <> p.organization_id;

-- Detail
SELECT a.display_id,
       a.organization_id AS current_org,
       p.organization_id AS assignee_org,
       a.created_by,
       a.assigned_to,
       a.start_at,
       a.status
FROM public.appointments a
JOIN public.profiles p ON p.id = a.assigned_to
WHERE p.organization_id IS NOT NULL
  AND a.organization_id <> p.organization_id
ORDER BY a.start_at;

-- Relocate
UPDATE public.appointments a
SET organization_id = p.organization_id,
    updated_at = now()
FROM public.profiles p
WHERE p.id = a.assigned_to
  AND p.organization_id IS NOT NULL
  AND a.organization_id <> p.organization_id;

-- Verify zero remain
SELECT 'Mis-filed appointments remaining' AS metric,
       COUNT(*)::text AS value
FROM public.appointments a
JOIN public.profiles p ON p.id = a.assigned_to
WHERE p.organization_id IS NOT NULL
  AND a.organization_id <> p.organization_id;
