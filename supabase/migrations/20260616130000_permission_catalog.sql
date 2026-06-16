-- Workstream K Stage 1 — permission_catalog metadata table.
--
-- Flat snake_case permission keys still live in roles.permissions (JSONB). This
-- table holds ONLY the presentation/grouping metadata for each key so the role
-- editors (org + HQ) can render grouped, labelled, tier-sorted permission grids
-- from a single source of truth. Seeded via migration; never written from app
-- code (no INSERT/UPDATE/DELETE policy). Public-read to authenticated users.
--
-- sort_order convention within a group: view=10, edit=20, manage=30, delete=40,
-- other=50.

BEGIN;

CREATE TABLE IF NOT EXISTS public.permission_catalog (
  key              text PRIMARY KEY,
  scope            text NOT NULL CHECK (scope IN ('org','hq')),
  group_slug       text NOT NULL,
  group_label      text NOT NULL,
  permission_label text NOT NULL,
  description      text NOT NULL,
  action_tier      text NOT NULL CHECK (action_tier IN ('view','edit','manage','delete','other')),
  sort_order       int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permission_catalog_scope_group_idx
  ON public.permission_catalog (scope, group_slug, sort_order);

ALTER TABLE public.permission_catalog ENABLE ROW LEVEL SECURITY;

-- Public-read metadata. DROP+CREATE keeps the policy idempotent across re-runs
-- (Postgres has no CREATE POLICY IF NOT EXISTS).
DROP POLICY IF EXISTS permission_catalog_select_authenticated ON public.permission_catalog;
CREATE POLICY permission_catalog_select_authenticated
  ON public.permission_catalog
  FOR SELECT TO authenticated
  USING (true);

INSERT INTO public.permission_catalog
  (key, scope, group_slug, group_label, permission_label, description, action_tier, sort_order)
VALUES
  -- ── ORG SCOPE (19) ─────────────────────────────────────────────────────────
  ('view_leads',                  'org', 'leads',              'Leads',                'View Leads',                'View leads in the org',                               'view',   10),
  ('edit_leads',                  'org', 'leads',              'Leads',                'Edit Leads',                'Create and edit leads',                               'edit',   20),
  ('view_tickets',                'org', 'tickets',            'Tickets',              'View Tickets',              'View support tickets',                                'view',   10),
  ('edit_tickets',                'org', 'tickets',            'Tickets',              'Edit Tickets',              'Reply to and resolve tickets',                        'edit',   20),
  ('view_appointments',           'org', 'appointments',      'Appointments',         'View Appointments',         'View appointments',                                   'view',   10),
  ('edit_appointments',           'org', 'appointments',      'Appointments',         'Edit Appointments',         'Create, update, and delete appointments',             'edit',   20),
  ('view_customers',              'org', 'customers',          'Customers',            'View Customers',            'View customer records',                               'view',   10),
  ('edit_customers',              'org', 'customers',          'Customers',            'Edit Customers',            'Create and edit customer records',                    'edit',   20),
  ('view_signals',                'org', 'signals',            'Signals',              'View Signals',              'View signals board',                                  'view',   10),
  ('edit_signal_settings',        'org', 'signals',            'Signals',              'Edit Signal Settings',      'Edit hunting profile, AI listening, engagement mode', 'edit',   20),
  ('manage_signals',              'org', 'signals',            'Signals',              'Act on Signals',            'Send, dismiss, approve, and unlock signals',          'manage', 30),
  ('manage_social_connections',   'org', 'social_connections', 'Social Connections',   'Manage Social Connections', 'Connect and disconnect OAuth platforms',              'manage', 30),
  ('manage_lead_settings',        'org', 'lead_settings',      'Lead Settings',        'Manage Lead Settings',      'Edit lead questions, magnet, lead email',             'manage', 30),
  ('manage_org_support_settings', 'org', 'support_settings',   'Support Settings',     'Manage Support Settings',   'Verify support email and manage inbound mailbox',     'manage', 30),
  ('manage_org_settings',         'org', 'org_settings',       'Organization Settings','Manage Org Settings',       'Edit branding, geofence, and logo',                   'manage', 30),
  ('manage_billing',              'org', 'billing',            'Billing',              'Manage Billing',            'Purchase credits and request top-ups',                'manage', 30),
  ('manage_team',                 'org', 'user_admin',         'User Administration',  'Manage Team',               'Invite members, assign custom roles, resend password resets', 'manage', 30),
  ('manage_roles',                'org', 'user_admin',         'User Administration',  'Manage Roles',              'Create, edit, and delete custom roles',               'manage', 30),
  ('view_analytics',              'org', 'analytics',          'Analytics',            'View Analytics',            'View dashboard analytics',                            'view',   10),
  -- ── HQ SCOPE (12) ──────────────────────────────────────────────────────────
  ('manage_organizations',        'hq',  'organizations',      'Organizations',        'Manage Organizations',      'Update, archive, restore, and geofence orgs',         'manage', 30),
  ('manage_org_integrations',     'hq',  'organizations',      'Organizations',        'Manage Org Integrations',   'Edit API keys, signal configs, lead magnet, AI strategy', 'manage', 30),
  ('send_claim_invites',          'hq',  'organizations',      'Organizations',        'Send Claim Invites',        'Send claim invitations to org owners',                'manage', 30),
  ('approve_applications',        'hq',  'applications',       'Applications',         'Approve Applications',      'Approve organization applications and provision new tenants', 'manage', 30),
  ('manage_platform_tickets',     'hq',  'platform_tickets',   'Platform Tickets',     'Manage Platform Tickets',   'Reply, close, and categorize HQ tickets',             'manage', 30),
  ('manage_ai_templates',         'hq',  'ai_templates',       'AI Templates',         'Manage AI Templates',       'Edit org AI strategy templates',                      'manage', 30),
  ('manage_platform_billing',     'hq',  'hq_billing',         'Billing',              'View Platform Billing',     'View HQ billing',                                     'view',   10),
  ('manage_credits',              'hq',  'hq_billing',         'Billing',              'Manage Credits',            'Add credits and configure auto top-up',               'manage', 30),
  ('manage_global_settings',      'hq',  'platform_settings',  'Platform Settings',    'Manage Global Settings',    'Edit platform-wide settings, ticket prefix, toggles', 'manage', 30),
  ('manage_support_settings',     'hq',  'platform_settings',  'Platform Settings',    'Manage HQ Support Settings','Edit HQ support settings',                            'manage', 30),
  ('manage_users',                'hq',  'hq_user_admin',      'User Administration',  'Manage Users',              'Invite, deactivate, and resend password reset for HQ users', 'manage', 30),
  ('manage_global_roles',         'hq',  'hq_user_admin',      'User Administration',  'Manage Global Roles',       'Create, edit, and delete HQ roles',                   'manage', 30)
ON CONFLICT (key) DO UPDATE SET
  scope            = excluded.scope,
  group_slug       = excluded.group_slug,
  group_label      = excluded.group_label,
  permission_label = excluded.permission_label,
  description      = excluded.description,
  action_tier      = excluded.action_tier,
  sort_order       = excluded.sort_order;

COMMIT;
