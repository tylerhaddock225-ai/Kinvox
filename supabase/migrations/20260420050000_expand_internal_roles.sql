-- ============================================================
-- Migration: Expand the internal_role enum with the full HQ
-- staff roster.
--
-- Existing values: 'platform_owner', 'platform_support'
-- Adding        : 'platform_admin', 'platform_sales',
--                 'platform_accounting'
--
-- Every member of this enum is treated as HQ staff — they bypass
-- the organization_id requirement and resolve to /admin-hq in the
-- centralized sorting hat (src/lib/supabase/middleware.ts). The
-- authoritative "is this user HQ?" check is:
--
--   system_role IS NOT NULL
--   -- or equivalently, in JS:
--   profile.system_role?.startsWith('platform_')
--
-- is_admin_hq() already returns TRUE for any non-null system_role,
-- so no RPC change is required — adding values to the enum is
-- enough.
--
-- Idempotency: IF NOT EXISTS on every ADD VALUE.
-- Transaction note: ALTER TYPE ... ADD VALUE IF NOT EXISTS runs
-- inside a transaction on Postgres 12+. We don't *consume* the
-- new values in the same migration, so the enum commit happens
-- cleanly before any downstream reader needs them.
-- ============================================================

alter type public.internal_role add value if not exists 'platform_admin';
alter type public.internal_role add value if not exists 'platform_sales';
alter type public.internal_role add value if not exists 'platform_accounting';
