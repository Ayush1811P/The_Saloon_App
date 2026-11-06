-- Salon coordinates already exist on salons; add only metadata required to
-- identify the displayed address, source and time of the last location update.

alter table public.salons
  add column if not exists location_description text,
  add column if not exists location_source text,
  add column if not exists location_updated_at timestamptz;

alter table public.salons
  drop constraint if exists salons_location_source_valid,
  add constraint salons_location_source_valid
    check (location_source is null or location_source in ('GPS', 'MANUAL')) not valid,
  drop constraint if exists salons_location_source_requires_coordinates,
  add constraint salons_location_source_requires_coordinates
    check (location_source is null or (latitude is not null and longitude is not null)) not valid;

comment on column public.salons.location_description is
  'Admin-entered address or landmark shown to customers for approximate travel reminders.';
comment on column public.salons.location_source is
  'Whether the saved salon coordinates were confirmed from GPS or entered manually.';
comment on column public.salons.location_updated_at is
  'Timestamp of the most recent admin update to salon location details.';

-- Existing salons RLS policies already restrict updates to salon owners/admins
-- and platform admins. Customer origin coordinates are never stored here.
