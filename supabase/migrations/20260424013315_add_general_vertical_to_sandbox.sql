-- Supplementary: backfill the 'general' vertical row on environments that
-- applied 20260423000001 before it was patched to seed 'general'. Idempotent
-- via ON CONFLICT, safe to apply anywhere.
insert into public.verticals (id, label)
values ('general', 'General')
on conflict (id) do nothing;
