-- One-time production cleanup: align Kinvox Demo Org's support inbound tag
-- with the post-Phase-A1 `<channel>-<orgSlug>` convention so the Settings
-- UI surfaces `support-kinvox-demo@inbound.kinvoxtech.com` instead of the
-- legacy `kinvox-demo-org-z5x4@…` from the old generateInboundEmailTag
-- (slug + base32 short-hash) pattern.
--
-- The lead-channel tag (`inbound_lead_email_tag`) is already `lead-kinvox-demo`
-- per the 2026-05-13 audit, so this migration intentionally touches only
-- the support column.
--
-- Idempotency: the double WHERE guard (slug = 'kinvox-demo' AND
-- inbound_email_tag = 'kinvox-demo-org-z5x4') makes this safe to re-run
-- and a no-op everywhere else — sandbox has no row matching either
-- predicate, and re-running on prod after this migration finds nothing
-- left to update. The post-UPDATE check then verifies the final state
-- across both columns and aborts via RAISE EXCEPTION if either is wrong.

DO $$
DECLARE
  v_support_tag text;
  v_lead_tag    text;
BEGIN
  UPDATE public.organizations
  SET inbound_email_tag = 'support-kinvox-demo'
  WHERE slug              = 'kinvox-demo'
    AND inbound_email_tag = 'kinvox-demo-org-z5x4';

  SELECT inbound_email_tag, inbound_lead_email_tag
  INTO v_support_tag, v_lead_tag
  FROM public.organizations
  WHERE slug = 'kinvox-demo';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'backfill_kinvox_demo_support_tag: no organization with slug=kinvox-demo (expected exactly one)';
  END IF;

  IF v_support_tag IS DISTINCT FROM 'support-kinvox-demo' THEN
    RAISE EXCEPTION
      'backfill_kinvox_demo_support_tag: post-update inbound_email_tag is %, expected support-kinvox-demo',
      v_support_tag;
  END IF;

  IF v_lead_tag IS DISTINCT FROM 'lead-kinvox-demo' THEN
    RAISE EXCEPTION
      'backfill_kinvox_demo_support_tag: inbound_lead_email_tag is %, expected lead-kinvox-demo (this migration should NOT have touched it)',
      v_lead_tag;
  END IF;

  RAISE NOTICE 'backfill_kinvox_demo_support_tag: ok (support_tag=%, lead_tag=%)',
    v_support_tag, v_lead_tag;
END $$;
