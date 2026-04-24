alter table public.organizations
  add column if not exists latitude      float8,
  add column if not exists longitude     float8,
  add column if not exists signal_radius int4 default 25;

comment on column public.organizations.signal_radius is 'Radius in miles for signal capturing geofence.';
