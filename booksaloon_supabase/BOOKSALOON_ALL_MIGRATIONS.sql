

-- ============================================================
-- FILE: BOOKSALOON_ALL_MIGRATIONS.sql
-- ============================================================


-- ============================================================
-- FILE: migrations/001_foundation_and_tenants.sql
-- ============================================================

-- BOOKSALOON | 001: Foundation, profiles, platform admins, salons and memberships
-- Run in order in Supabase SQL Editor or through Supabase CLI migrations.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.account_status as enum ('ACTIVE', 'SUSPENDED', 'DELETED');
create type public.salon_status as enum ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED');
create type public.member_role as enum ('OWNER', 'ADMIN', 'STAFF');
create type public.employee_status as enum ('ACTIVE', 'INACTIVE', 'ON_LEAVE');
create type public.chair_status as enum ('FREE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE');
create type public.booking_type as enum ('NORMAL', 'QUICK_TURN', 'WALK_IN');
create type public.booking_status as enum (
  'PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED',
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
);
create type public.payment_status as enum ('NOT_PAID', 'PAY_AT_SALON', 'PAID_EXTERNALLY', 'REFUNDED');
create type public.queue_status as enum ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED');
create type public.assignment_status as enum ('ACTIVE', 'RELEASED', 'CANCELLED');
create type public.discount_type as enum ('PERCENTAGE', 'FIXED');
create type public.offer_status as enum ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');
create type public.notification_type as enum (
  'BOOKING_CONFIRMED', 'BARBER_ASSIGNED', 'QUEUE_UPDATE', 'TURN_APPROACHING',
  'CHAIR_READY', 'BOOKING_CANCELLED', 'OFFER', 'ANNOUNCEMENT', 'GENERAL'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  email text,
  avatar_url text,
  account_status public.account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_phone_unique on public.profiles(phone) where phone is not null;

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  country_code text not null default 'IN',
  latitude numeric(9,6),
  longitude numeric(9,6),
  timezone text not null default 'Asia/Kolkata',
  logo_url text,
  cover_image_url text,
  status public.salon_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salons_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint salons_longitude_range check (longitude is null or longitude between -180 and 180)
);

create table public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null,
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create index salon_members_user_idx on public.salon_members(user_id);
create index salons_status_idx on public.salons(status);

-- Keep profile data synchronized with Supabase Auth.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, email, full_name)
  values (
    new.id,
    nullif(new.phone, ''),
    nullif(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update set
    phone = coalesce(excluded.phone, public.profiles.phone),
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_booksaloon on auth.users;
create trigger on_auth_user_created_booksaloon
after insert or update of phone, email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger salons_updated_at before update on public.salons
for each row execute function public.set_updated_at();
create trigger salon_members_updated_at before update on public.salon_members
for each row execute function public.set_updated_at();


-- ============================================================
-- FILE: migrations/002_salon_operations.sql
-- ============================================================

-- BOOKSALOON | 002: Salon hours, employees, schedules, chairs and services

create table public.salon_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opening_time time,
  closing_time time,
  is_closed boolean not null default false,
  unique (salon_id, day_of_week),
  check (is_closed or (opening_time is not null and closing_time is not null and closing_time > opening_time))
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  phone text,
  email text,
  designation text not null default 'BARBER',
  experience_years integer not null default 0 check (experience_years >= 0),
  status public.employee_status not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);
create index employees_salon_status_idx on public.employees(salon_id, status);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, name)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null,
  description text,
  price_paise integer not null check (price_paise >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, name),
  unique (id, salon_id)
);
create index services_salon_active_idx on public.services(salon_id, is_active);

create table public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  proficiency_level text not null default 'STANDARD'
    check (proficiency_level in ('BEGINNER', 'STANDARD', 'EXPERT')),
  created_at timestamptz not null default now(),
  unique (employee_id, service_id)
);

create table public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_working boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index employee_shifts_employee_date_idx on public.employee_shifts(employee_id, shift_date);

create table public.employee_breaks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  status text not null default 'APPROVED' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  chair_number text not null,
  chair_name text,
  status public.chair_status not null default 'FREE',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, chair_number),
  unique (id, salon_id)
);

create trigger employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();
create trigger services_updated_at before update on public.services
for each row execute function public.set_updated_at();


-- ============================================================
-- FILE: migrations/003_offers_and_bookings.sql
-- ============================================================

-- BOOKSALOON | 003: Offers, coupons, bookings, booking line items and assignments

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  title text not null,
  description text,
  discount_type public.discount_type not null,
  discount_value numeric(12,2) not null check (discount_value > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.offer_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (discount_type <> 'PERCENTAGE' or discount_value <= 100)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  coupon_code text not null,
  usage_limit integer check (usage_limit is null or usage_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  minimum_amount_paise integer not null default 0 check (minimum_amount_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, coupon_code)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  booking_number text not null,
  booking_type public.booking_type not null default 'NORMAL',
  status public.booking_status not null default 'PENDING',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  subtotal_paise integer not null default 0 check (subtotal_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  total_paise integer not null default 0 check (total_paise >= 0),
  payment_method text not null default 'PAY_AT_SALON'
    check (payment_method in ('PAY_AT_SALON', 'EXTERNAL')),
  payment_status public.payment_status not null default 'PAY_AT_SALON',
  customer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, booking_number),
  check (scheduled_end > scheduled_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start),
  check (discount_paise <= subtotal_paise),
  check (total_paise = subtotal_paise - discount_paise),
  unique (id, salon_id)
);
create index bookings_salon_start_idx on public.bookings(salon_id, scheduled_start);
create index bookings_customer_created_idx on public.bookings(customer_id, created_at desc);
create index bookings_salon_status_idx on public.bookings(salon_id, status);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  total_price_paise integer generated always as (quantity * unit_price_paise) stored,
  created_at timestamptz not null default now()
);

create table public.booking_staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  assignment_type text not null default 'AUTOMATIC'
    check (assignment_type in ('AUTOMATIC', 'MANUAL')),
  status public.assignment_status not null default 'ACTIVE',
  assigned_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index booking_staff_booking_idx on public.booking_staff(booking_id);
alter table public.booking_staff
  add constraint booking_staff_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'ACTIVE');

create table public.booking_resources (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  chair_id uuid not null references public.chairs(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.assignment_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index booking_resources_booking_idx on public.booking_resources(booking_id);
alter table public.booking_resources
  add constraint booking_chair_no_overlap
  exclude using gist (
    chair_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'ACTIVE');

create trigger bookings_updated_at before update on public.bookings
for each row execute function public.set_updated_at();
create trigger offers_updated_at before update on public.offers
for each row execute function public.set_updated_at();

-- Important: exclusion constraints are the final database-level protection against
-- overlapping active employee/chair assignments. Assignment rows must be created
-- inside one transaction by a trusted RPC/backend operation.


-- ============================================================
-- FILE: migrations/004_queue_notifications_and_customer_features.sql
-- ============================================================

-- BOOKSALOON | 004: Queue, notifications, preferences, favorites and reviews

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  queue_date date not null,
  queue_number integer not null check (queue_number > 0),
  estimated_wait_minutes integer check (estimated_wait_minutes is null or estimated_wait_minutes >= 0),
  estimated_start_at timestamptz,
  called_at timestamptz,
  service_started_at timestamptz,
  completed_at timestamptz,
  status public.queue_status not null default 'WAITING',
  created_at timestamptz not null default now(),
  unique (salon_id, queue_date, queue_number)
);
create index queue_entries_live_idx on public.queue_entries(salon_id, queue_date, status, queue_number);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  salon_id uuid references public.salons(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  title text not null,
  message text not null,
  notification_type public.notification_type not null default 'GENERAL',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, is_read, created_at desc);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  booking_updates boolean not null default true,
  queue_updates boolean not null default true,
  offers boolean not null default true,
  announcements boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, salon_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index reviews_salon_created_idx on public.reviews(salon_id, created_at desc);


-- ============================================================
-- FILE: migrations/005_settings_audit_and_integrity.sql
-- ============================================================

-- BOOKSALOON | 005: Salon settings, audit log and cross-tenant integrity guards

create table public.salon_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (salon_id, setting_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_salon_created_idx on public.audit_logs(salon_id, created_at desc);

-- Prevent cross-tenant references even if a privileged client submits mismatched IDs.
create or replace function public.assert_employee_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.salon_id = new.salon_id
  ) then raise exception 'Employee does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger employee_skills_salon_guard
before insert or update on public.employee_skills
for each row execute function public.assert_employee_salon();

create or replace function public.assert_service_category_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.service_categories c
    where c.id = new.category_id and c.salon_id = new.salon_id
  ) then raise exception 'Category does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger services_category_salon_guard
before insert or update on public.services
for each row execute function public.assert_service_category_salon();

create or replace function public.assert_booking_child_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id and b.salon_id = new.salon_id
  ) then raise exception 'Booking does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_items_salon_guard
before insert or update on public.booking_items
for each row execute function public.assert_booking_child_salon();

create trigger booking_staff_salon_guard
before insert or update on public.booking_staff
for each row execute function public.assert_booking_child_salon();

create trigger booking_resources_salon_guard
before insert or update on public.booking_resources
for each row execute function public.assert_booking_child_salon();

create trigger queue_entries_salon_guard
before insert or update on public.queue_entries
for each row execute function public.assert_booking_child_salon();

create or replace function public.assert_chair_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.chairs c
    where c.id = new.chair_id and c.salon_id = new.salon_id
  ) then raise exception 'Chair does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_resources_chair_guard
before insert or update on public.booking_resources
for each row execute function public.assert_chair_salon();

create or replace function public.assert_staff_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.salon_id = new.salon_id
  ) then raise exception 'Employee does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_staff_employee_guard
before insert or update on public.booking_staff
for each row execute function public.assert_staff_salon();


-- ============================================================
-- FILE: migrations/006_rls_policies.sql
-- ============================================================

-- BOOKSALOON | 006: Row Level Security
-- All tenant-owned rows are scoped through salon_members.
-- Never expose the Supabase service-role key in a browser.

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_salon_member(p_salon_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
  );
$$;

create or replace function public.has_salon_role(p_salon_id uuid, p_roles public.member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
      and sm.role = any(p_roles)
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_salon_member(uuid) to authenticated;
grant execute on function public.has_salon_role(uuid, public.member_role[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.salons enable row level security;
alter table public.salon_members enable row level security;
alter table public.salon_hours enable row level security;
alter table public.employees enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_shifts enable row level security;
alter table public.employee_breaks enable row level security;
alter table public.employee_leaves enable row level security;
alter table public.chairs enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_staff enable row level security;
alter table public.booking_resources enable row level security;
alter table public.queue_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.reviews enable row level security;
alter table public.salon_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users can read/update their own profile. Platform admins can read all.
create policy profiles_select_own_or_platform on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_platform_admin());
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Platform admin membership is deliberately not self-service.
create policy platform_admins_select_self on public.platform_admins
for select to authenticated using (user_id = auth.uid());

-- Public salon discovery exposes only active salons.
create policy salons_public_active_select on public.salons
for select to anon, authenticated
using (status = 'ACTIVE');
create policy salons_member_select on public.salons
for select to authenticated
using (public.is_salon_member(id) or public.is_platform_admin());
create policy salons_insert_authenticated on public.salons
for insert to authenticated
with check (created_by = auth.uid());
create policy salons_update_owner_admin on public.salons
for update to authenticated
using (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy salon_members_select on public.salon_members
for select to authenticated
using (user_id = auth.uid() or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_insert_owner on public.salon_members
for insert to authenticated
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_update_owner on public.salon_members
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_delete_owner on public.salon_members
for delete to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());

-- Salon catalogue: publicly readable only for active salons and active catalogue entries.
create policy salon_hours_public_select on public.salon_hours
for select to anon, authenticated
using (exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy salon_hours_manage on public.salon_hours
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy categories_public_select on public.service_categories
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy categories_manage on public.service_categories
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy services_public_select on public.services
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy services_manage on public.services
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy offers_public_select on public.offers
for select to anon, authenticated
using (status = 'ACTIVE' and starts_at <= now() and ends_at > now()
  and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy offers_manage on public.offers
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy coupons_public_validate_select on public.coupons
for select to authenticated
using (is_active and public.is_salon_member(salon_id));
create policy coupons_manage on public.coupons
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Employee personal records are not public. Salon members can see employees; owners/admins manage them.
create policy employees_member_select on public.employees
for select to authenticated
using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employees_manage on public.employees
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_skills_member_select on public.employee_skills
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_skills_manage on public.employee_skills
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_shifts_member_select on public.employee_shifts
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_shifts_manage on public.employee_shifts
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_breaks_member_select on public.employee_breaks
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_breaks_manage on public.employee_breaks
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_leaves_member_select on public.employee_leaves
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_leaves_manage on public.employee_leaves
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy chairs_public_select on public.chairs
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy chairs_manage on public.chairs
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Booking visibility: customer sees own; salon members see their salon's bookings.
create policy bookings_select_customer_or_member on public.bookings
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy bookings_insert_customer on public.bookings
for insert to authenticated
with check (customer_id = auth.uid() and status = 'PENDING');
create policy bookings_manage_salon on public.bookings
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());
create policy bookings_customer_cancel on public.bookings
for update to authenticated
using (customer_id = auth.uid() and status in ('PENDING','CONFIRMED','WAITING'))
with check (customer_id = auth.uid() and status = 'CANCELLED');

create policy booking_items_select_related on public.booking_items
for select to authenticated
using (exists (select 1 from public.bookings b where b.id = booking_id
  and (b.customer_id = auth.uid() or public.is_salon_member(b.salon_id) or public.is_platform_admin())));
create policy booking_items_insert_own_pending on public.booking_items
for insert to authenticated
with check (exists (select 1 from public.bookings b where b.id = booking_id
  and b.customer_id = auth.uid() and b.status = 'PENDING' and b.salon_id = salon_id));
create policy booking_items_manage_salon on public.booking_items
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_staff_member_select on public.booking_staff
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_staff_manage on public.booking_staff
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_resources_member_select on public.booking_resources
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_resources_manage on public.booking_resources
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy queue_customer_or_member_select on public.queue_entries
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy queue_manage_salon on public.queue_entries
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy notifications_own_select on public.notifications
for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
create policy notifications_own_update on public.notifications
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Notification creation should be performed by trusted server/RPC, not arbitrary customers.

create policy notification_preferences_own on public.notification_preferences
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy favorites_own on public.customer_favorites
for all to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy reviews_public_select on public.reviews
for select to anon, authenticated using (true);
create policy reviews_customer_insert on public.reviews
for insert to authenticated
with check (customer_id = auth.uid() and exists (
  select 1 from public.bookings b
  where b.id = booking_id and b.customer_id = auth.uid()
    and b.salon_id = salon_id and b.status = 'COMPLETED'
));
create policy reviews_customer_update on public.reviews
for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy salon_settings_member_select on public.salon_settings
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy salon_settings_manage on public.salon_settings
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy audit_logs_owner_select on public.audit_logs
for select to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
-- Audit log inserts should be made by trusted server-side functions.


-- ============================================================
-- FILE: migrations/007_rpc_helpers_and_realtime.sql
-- ============================================================

-- BOOKSALOON | 007: Safe RPC helpers, salon onboarding and queue numbering
-- These are starting primitives. Implement full booking/assignment in a single
-- transactional RPC before allowing customers to create live bookings.

-- Create a salon and automatically link the caller as OWNER.
create or replace function public.create_salon(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Salon name is required'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid salon slug'; end if;

  insert into public.salons (created_by, name, slug, phone, city, state)
  values (auth.uid(), trim(p_name), p_slug, p_phone, p_city, p_state)
  returning id into v_salon_id;

  insert into public.salon_members (salon_id, user_id, role)
  values (v_salon_id, auth.uid(), 'OWNER');

  return v_salon_id;
end;
$$;

revoke all on function public.create_salon(text,text,text,text,text) from public;
grant execute on function public.create_salon(text,text,text,text,text) to authenticated;

-- Generate the next queue number safely for a salon and local queue date.
-- Call within the same transaction that inserts the queue entry.
create or replace function public.next_queue_number(p_salon_id uuid, p_queue_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not public.is_salon_member(p_salon_id) and not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_salon_id::text || ':' || p_queue_date::text, 0)
  );

  select coalesce(max(queue_number), 0) + 1
    into v_next
  from public.queue_entries
  where salon_id = p_salon_id and queue_date = p_queue_date;

  return v_next;
end;
$$;

revoke all on function public.next_queue_number(uuid,date) from public;
grant execute on function public.next_queue_number(uuid,date) to authenticated;

-- Enable Realtime publication for tables whose changes should update clients.
-- Supabase may already have some tables in this publication; duplicate-safe blocks.
do $$
declare t text;
begin
  foreach t in array array['bookings','queue_entries','notifications','chairs','booking_staff','booking_resources'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable Realtime publication in Supabase dashboard later.';
end $$;


-- ============================================================
-- FILE: migrations/008_seed_demo_data.sql
-- ============================================================

-- BOOKSALOON | 008: Optional development seed data
-- This seeds salon catalogue data only. It does not create auth users.
-- Replace the placeholder salon UUID below with a real salon ID after onboarding.

-- Example:
-- insert into public.service_categories (salon_id, name, sort_order)
-- values ('00000000-0000-0000-0000-000000000001', 'Hair', 1),
--        ('00000000-0000-0000-0000-000000000001', 'Beard', 2);
--
-- insert into public.services
--   (salon_id, category_id, name, description, price_paise, duration_minutes)
-- values
--   ('00000000-0000-0000-0000-000000000001', '<CATEGORY_UUID>', 'Classic Haircut',
--    'Standard haircut', 20000, 30),
--   ('00000000-0000-0000-0000-000000000001', '<CATEGORY_UUID>', 'Beard Trim',
--    'Beard shaping and trim', 10000, 15);
--
-- Intentionally no fake production users, bookings, or payments are inserted.


-- ============================================================
-- FILE: migrations/010_admin_sessions.sql
-- ============================================================
-- BOOKSALOON | 010: Server-side admin sessions
-- Supabase Auth remains responsible for password verification. This table
-- tracks dashboard sessions and makes the three-device limit enforceable by RPC.

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index admin_sessions_active_idx
  on public.admin_sessions (created_at)
  where revoked_at is null;

alter table public.admin_sessions enable row level security;

create or replace function public.issue_admin_session(p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null or not exists (
    select 1
    from public.platform_admins
    where user_id = v_user_id
  ) then
    raise exception 'ADMIN_ACCESS_REQUIRED' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('booksaloon-admin-session-limit', 0));

  update public.admin_sessions
  set revoked_at = now(),
      revoked_reason = 'SESSION_LIMIT'
  where id = (
    select id
    from public.admin_sessions
    where revoked_at is null
    order by created_at asc
    offset 2
    limit 1
  );

  insert into public.admin_sessions (user_id, user_agent)
  values (v_user_id, nullif(trim(p_user_agent), ''))
  returning id into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.validate_admin_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.admin_sessions
  set last_seen_at = now()
  where id = p_session_id
    and user_id = auth.uid()
    and revoked_at is null;

  return found;
end;
$$;

create or replace function public.revoke_admin_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admin_sessions
  set revoked_at = now(),
      revoked_reason = 'LOGOUT'
  where id = p_session_id
    and user_id = auth.uid()
    and revoked_at is null;

  return found;
end;
$$;

revoke all on public.admin_sessions from public, anon, authenticated;
revoke all on function public.issue_admin_session(text) from public, anon;
revoke all on function public.validate_admin_session(uuid) from public, anon;
revoke all on function public.revoke_admin_session(uuid) from public, anon;
grant execute on function public.issue_admin_session(text) to authenticated;
grant execute on function public.validate_admin_session(uuid) to authenticated;
grant execute on function public.revoke_admin_session(uuid) to authenticated;


-- ============================================================
-- FILE: migrations/011_queue_arrival_policy.sql
-- ============================================================
-- BOOKSALOON | 011: Queue arrival and no-show policy

create or replace function public.expire_overdue_queue_entries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  with overdue as (
    select qe.id, qe.booking_id, qe.customer_id, qe.salon_id
    from public.queue_entries qe
    where qe.status = 'CALLED'
      and qe.called_at <= now() - interval '10 minutes'
      and (
        public.is_platform_admin()
        or public.is_salon_member(qe.salon_id)
        or qe.customer_id = auth.uid()
      )
    for update
  ),
  marked_queue as (
    update public.queue_entries qe
    set status = 'SKIPPED',
        completed_at = now()
    from overdue o
    where qe.id = o.id
    returning o.booking_id, o.customer_id, o.salon_id
  ),
  marked_bookings as (
    update public.bookings b
    set status = 'NO_SHOW',
        updated_at = now()
    from marked_queue mq
    where b.id = mq.booking_id
      and b.status in ('WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS', 'CONFIRMED')
    returning mq.customer_id, mq.salon_id, b.id
  )
  insert into public.notifications (
    user_id, salon_id, booking_id, title, message, notification_type
  )
  select customer_id, salon_id, id,
         'Appointment missed',
         'Your turn was held for 10 minutes. The appointment was released because you did not arrive.',
         'GENERAL'
  from marked_bookings;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.bookings where id = p_booking_id) then
    raise exception 'Booking not found';
  end if;

  update public.bookings
  set status = 'CANCELLED', updated_at = now()
  where id = p_booking_id;

  update public.queue_entries
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status in ('WAITING', 'CALLED');

  update public.booking_staff
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';

  update public.booking_resources
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';
end;
$$;

revoke all on function public.expire_overdue_queue_entries() from public, anon;
revoke all on function public.admin_cancel_booking(uuid) from public, anon;
grant execute on function public.expire_overdue_queue_entries() to authenticated;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;


-- ============================================================
-- FILE: migrations/001_foundation_and_tenants.sql
-- ============================================================
-- BOOKSALOON | 001: Foundation, profiles, platform admins, salons and memberships
-- Run in order in Supabase SQL Editor or through Supabase CLI migrations.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.account_status as enum ('ACTIVE', 'SUSPENDED', 'DELETED');
create type public.salon_status as enum ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED');
create type public.member_role as enum ('OWNER', 'ADMIN', 'STAFF');
create type public.employee_status as enum ('ACTIVE', 'INACTIVE', 'ON_LEAVE');
create type public.chair_status as enum ('FREE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE');
create type public.booking_type as enum ('NORMAL', 'QUICK_TURN', 'WALK_IN');
create type public.booking_status as enum (
  'PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED',
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
);
create type public.payment_status as enum ('NOT_PAID', 'PAY_AT_SALON', 'PAID_EXTERNALLY', 'REFUNDED');
create type public.queue_status as enum ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED');
create type public.assignment_status as enum ('ACTIVE', 'RELEASED', 'CANCELLED');
create type public.discount_type as enum ('PERCENTAGE', 'FIXED');
create type public.offer_status as enum ('DRAFT', 'ACTIVE', 'INACTIVE', 'EXPIRED');
create type public.notification_type as enum (
  'BOOKING_CONFIRMED', 'BARBER_ASSIGNED', 'QUEUE_UPDATE', 'TURN_APPROACHING',
  'CHAIR_READY', 'BOOKING_CANCELLED', 'OFFER', 'ANNOUNCEMENT', 'GENERAL'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  email text,
  avatar_url text,
  account_status public.account_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_phone_unique on public.profiles(phone) where phone is not null;

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  slug text not null unique,
  description text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  pincode text,
  country_code text not null default 'IN',
  latitude numeric(9,6),
  longitude numeric(9,6),
  timezone text not null default 'Asia/Kolkata',
  logo_url text,
  cover_image_url text,
  status public.salon_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salons_latitude_range check (latitude is null or latitude between -90 and 90),
  constraint salons_longitude_range check (longitude is null or longitude between -180 and 180)
);

create table public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null,
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create index salon_members_user_idx on public.salon_members(user_id);
create index salons_status_idx on public.salons(status);

-- Keep profile data synchronized with Supabase Auth.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone, email, full_name)
  values (
    new.id,
    nullif(new.phone, ''),
    nullif(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update set
    phone = coalesce(excluded.phone, public.profiles.phone),
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_booksaloon on auth.users;
create trigger on_auth_user_created_booksaloon
after insert or update of phone, email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger salons_updated_at before update on public.salons
for each row execute function public.set_updated_at();
create trigger salon_members_updated_at before update on public.salon_members
for each row execute function public.set_updated_at();


-- ============================================================
-- FILE: migrations/002_salon_operations.sql
-- ============================================================
-- BOOKSALOON | 002: Salon hours, employees, schedules, chairs and services

create table public.salon_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opening_time time,
  closing_time time,
  is_closed boolean not null default false,
  unique (salon_id, day_of_week),
  check (is_closed or (opening_time is not null and closing_time is not null and closing_time > opening_time))
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  phone text,
  email text,
  designation text not null default 'BARBER',
  experience_years integer not null default 0 check (experience_years >= 0),
  status public.employee_status not null default 'ACTIVE',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);
create index employees_salon_status_idx on public.employees(salon_id, status);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, name)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null,
  description text,
  price_paise integer not null check (price_paise >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, name),
  unique (id, salon_id)
);
create index services_salon_active_idx on public.services(salon_id, is_active);

create table public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  proficiency_level text not null default 'STANDARD'
    check (proficiency_level in ('BEGINNER', 'STANDARD', 'EXPERT')),
  created_at timestamptz not null default now(),
  unique (employee_id, service_id)
);

create table public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  is_working boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index employee_shifts_employee_date_idx on public.employee_shifts(employee_id, shift_date);

create table public.employee_breaks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  status text not null default 'APPROVED' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.chairs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  chair_number text not null,
  chair_name text,
  status public.chair_status not null default 'FREE',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, chair_number),
  unique (id, salon_id)
);

create trigger employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();
create trigger services_updated_at before update on public.services
for each row execute function public.set_updated_at();


-- ============================================================
-- FILE: migrations/003_offers_and_bookings.sql
-- ============================================================
-- BOOKSALOON | 003: Offers, coupons, bookings, booking line items and assignments

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  title text not null,
  description text,
  discount_type public.discount_type not null,
  discount_value numeric(12,2) not null check (discount_value > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.offer_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (discount_type <> 'PERCENTAGE' or discount_value <= 100)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  coupon_code text not null,
  usage_limit integer check (usage_limit is null or usage_limit >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  minimum_amount_paise integer not null default 0 check (minimum_amount_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, coupon_code)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  booking_number text not null,
  booking_type public.booking_type not null default 'NORMAL',
  status public.booking_status not null default 'PENDING',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  actual_start timestamptz,
  actual_end timestamptz,
  subtotal_paise integer not null default 0 check (subtotal_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  total_paise integer not null default 0 check (total_paise >= 0),
  payment_method text not null default 'PAY_AT_SALON'
    check (payment_method in ('PAY_AT_SALON', 'EXTERNAL')),
  payment_status public.payment_status not null default 'PAY_AT_SALON',
  customer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, booking_number),
  check (scheduled_end > scheduled_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start),
  check (discount_paise <= subtotal_paise),
  check (total_paise = subtotal_paise - discount_paise),
  unique (id, salon_id)
);
create index bookings_salon_start_idx on public.bookings(salon_id, scheduled_start);
create index bookings_customer_created_idx on public.bookings(customer_id, created_at desc);
create index bookings_salon_status_idx on public.bookings(salon_id, status);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  total_price_paise integer generated always as (quantity * unit_price_paise) stored,
  created_at timestamptz not null default now()
);

create table public.booking_staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  assignment_type text not null default 'AUTOMATIC'
    check (assignment_type in ('AUTOMATIC', 'MANUAL')),
  status public.assignment_status not null default 'ACTIVE',
  assigned_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index booking_staff_booking_idx on public.booking_staff(booking_id);
alter table public.booking_staff
  add constraint booking_staff_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'ACTIVE');

create table public.booking_resources (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  chair_id uuid not null references public.chairs(id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.assignment_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index booking_resources_booking_idx on public.booking_resources(booking_id);
alter table public.booking_resources
  add constraint booking_chair_no_overlap
  exclude using gist (
    chair_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'ACTIVE');

create trigger bookings_updated_at before update on public.bookings
for each row execute function public.set_updated_at();
create trigger offers_updated_at before update on public.offers
for each row execute function public.set_updated_at();

-- Important: exclusion constraints are the final database-level protection against
-- overlapping active employee/chair assignments. Assignment rows must be created
-- inside one transaction by a trusted RPC/backend operation.


-- ============================================================
-- FILE: migrations/004_queue_notifications_and_customer_features.sql
-- ============================================================
-- BOOKSALOON | 004: Queue, notifications, preferences, favorites and reviews

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  queue_date date not null,
  queue_number integer not null check (queue_number > 0),
  estimated_wait_minutes integer check (estimated_wait_minutes is null or estimated_wait_minutes >= 0),
  estimated_start_at timestamptz,
  called_at timestamptz,
  service_started_at timestamptz,
  completed_at timestamptz,
  status public.queue_status not null default 'WAITING',
  created_at timestamptz not null default now(),
  unique (salon_id, queue_date, queue_number)
);
create index queue_entries_live_idx on public.queue_entries(salon_id, queue_date, status, queue_number);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  salon_id uuid references public.salons(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  title text not null,
  message text not null,
  notification_type public.notification_type not null default 'GENERAL',
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(user_id, is_read, created_at desc);

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  booking_updates boolean not null default true,
  queue_updates boolean not null default true,
  offers boolean not null default true,
  announcements boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.customer_favorites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, salon_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index reviews_salon_created_idx on public.reviews(salon_id, created_at desc);


-- ============================================================
-- FILE: migrations/005_settings_audit_and_integrity.sql
-- ============================================================
-- BOOKSALOON | 005: Salon settings, audit log and cross-tenant integrity guards

create table public.salon_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (salon_id, setting_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_salon_created_idx on public.audit_logs(salon_id, created_at desc);

-- Prevent cross-tenant references even if a privileged client submits mismatched IDs.
create or replace function public.assert_employee_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.salon_id = new.salon_id
  ) then raise exception 'Employee does not belong to this salon'; end if;
  if not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.salon_id = new.salon_id
  ) then raise exception 'Service does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger employee_skills_salon_guard
before insert or update on public.employee_skills
for each row execute function public.assert_employee_salon();

create or replace function public.assert_service_category_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.service_categories c
    where c.id = new.category_id and c.salon_id = new.salon_id
  ) then raise exception 'Category does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger services_category_salon_guard
before insert or update on public.services
for each row execute function public.assert_service_category_salon();

create or replace function public.assert_booking_child_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id and b.salon_id = new.salon_id
  ) then raise exception 'Booking does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_items_salon_guard
before insert or update on public.booking_items
for each row execute function public.assert_booking_child_salon();

create trigger booking_staff_salon_guard
before insert or update on public.booking_staff
for each row execute function public.assert_booking_child_salon();

create trigger booking_resources_salon_guard
before insert or update on public.booking_resources
for each row execute function public.assert_booking_child_salon();

create trigger queue_entries_salon_guard
before insert or update on public.queue_entries
for each row execute function public.assert_booking_child_salon();

create or replace function public.assert_chair_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.chairs c
    where c.id = new.chair_id and c.salon_id = new.salon_id
  ) then raise exception 'Chair does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_resources_chair_guard
before insert or update on public.booking_resources
for each row execute function public.assert_chair_salon();

create or replace function public.assert_staff_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.salon_id = new.salon_id
  ) then raise exception 'Employee does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_staff_employee_guard
before insert or update on public.booking_staff
for each row execute function public.assert_staff_salon();


create or replace function public.assert_booking_item_service_salon()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.service_id is not null and not exists (
    select 1 from public.services s
    where s.id = new.service_id and s.salon_id = new.salon_id
  ) then raise exception 'Service does not belong to this salon'; end if;
  return new;
end;
$$;

create trigger booking_items_service_salon_guard
before insert or update on public.booking_items
for each row execute function public.assert_booking_item_service_salon();


-- ============================================================
-- FILE: migrations/006_rls_policies.sql
-- ============================================================
-- BOOKSALOON | 006: Row Level Security
-- All tenant-owned rows are scoped through salon_members.
-- Never expose the Supabase service-role key in a browser.

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_salon_member(p_salon_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
  );
$$;

create or replace function public.has_salon_role(p_salon_id uuid, p_roles public.member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
      and sm.role = any(p_roles)
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_salon_member(uuid) to authenticated;
grant execute on function public.has_salon_role(uuid, public.member_role[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.salons enable row level security;
alter table public.salon_members enable row level security;
alter table public.salon_hours enable row level security;
alter table public.employees enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_shifts enable row level security;
alter table public.employee_breaks enable row level security;
alter table public.employee_leaves enable row level security;
alter table public.chairs enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_staff enable row level security;
alter table public.booking_resources enable row level security;
alter table public.queue_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.reviews enable row level security;
alter table public.salon_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users can read/update their own profile. Platform admins can read all.
create policy profiles_select_own_or_platform on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_platform_admin());
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Platform admin membership is deliberately not self-service.
create policy platform_admins_select_self on public.platform_admins
for select to authenticated using (user_id = auth.uid());

-- Public salon discovery exposes only active salons.
create policy salons_public_active_select on public.salons
for select to anon, authenticated
using (status = 'ACTIVE');
create policy salons_member_select on public.salons
for select to authenticated
using (public.is_salon_member(id) or public.is_platform_admin());
create policy salons_insert_authenticated on public.salons
for insert to authenticated
with check (created_by = auth.uid());
create policy salons_update_owner_admin on public.salons
for update to authenticated
using (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy salon_members_select on public.salon_members
for select to authenticated
using (user_id = auth.uid() or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_insert_owner on public.salon_members
for insert to authenticated
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_update_owner on public.salon_members
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_delete_owner on public.salon_members
for delete to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());

-- Salon catalogue: publicly readable only for active salons and active catalogue entries.
create policy salon_hours_public_select on public.salon_hours
for select to anon, authenticated
using (exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy salon_hours_manage on public.salon_hours
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy categories_public_select on public.service_categories
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy categories_manage on public.service_categories
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy services_public_select on public.services
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy services_manage on public.services
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy offers_public_select on public.offers
for select to anon, authenticated
using (status = 'ACTIVE' and starts_at <= now() and ends_at > now()
  and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy offers_manage on public.offers
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy coupons_public_validate_select on public.coupons
for select to authenticated
using (is_active and public.is_salon_member(salon_id));
create policy coupons_manage on public.coupons
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Employee personal records are not public. Salon members can see employees; owners/admins manage them.
create policy employees_member_select on public.employees
for select to authenticated
using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employees_manage on public.employees
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_skills_member_select on public.employee_skills
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_skills_manage on public.employee_skills
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_shifts_member_select on public.employee_shifts
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_shifts_manage on public.employee_shifts
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_breaks_member_select on public.employee_breaks
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_breaks_manage on public.employee_breaks
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_leaves_member_select on public.employee_leaves
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_leaves_manage on public.employee_leaves
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy chairs_public_select on public.chairs
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy chairs_manage on public.chairs
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Booking visibility: customer sees own; salon members see their salon's bookings.
create policy bookings_select_customer_or_member on public.bookings
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy bookings_insert_customer on public.bookings
for insert to authenticated
with check (customer_id = auth.uid() and status = 'PENDING');
create policy bookings_manage_salon on public.bookings
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());
-- Customers cannot directly update booking rows. Use the cancel_booking RPC
-- so they cannot alter prices, assignments, salon_id or timestamps while cancelling.

create policy booking_items_select_related on public.booking_items
for select to authenticated
using (exists (select 1 from public.bookings b where b.id = booking_id
  and (b.customer_id = auth.uid() or public.is_salon_member(b.salon_id) or public.is_platform_admin())));
create policy booking_items_insert_own_pending on public.booking_items
for insert to authenticated
with check (exists (select 1 from public.bookings b where b.id = booking_id
  and b.customer_id = auth.uid() and b.status = 'PENDING' and b.salon_id = salon_id));
create policy booking_items_manage_salon on public.booking_items
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_staff_member_select on public.booking_staff
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_staff_manage on public.booking_staff
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_resources_member_select on public.booking_resources
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_resources_manage on public.booking_resources
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy queue_customer_or_member_select on public.queue_entries
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy queue_manage_salon on public.queue_entries
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy notifications_own_select on public.notifications
for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
create policy notifications_own_update on public.notifications
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Notification creation should be performed by trusted server/RPC, not arbitrary customers.

create policy notification_preferences_own on public.notification_preferences
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy favorites_own on public.customer_favorites
for all to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy reviews_public_select on public.reviews
for select to anon, authenticated using (true);
create policy reviews_customer_insert on public.reviews
for insert to authenticated
with check (customer_id = auth.uid() and exists (
  select 1 from public.bookings b
  where b.id = booking_id and b.customer_id = auth.uid()
    and b.salon_id = salon_id and b.status = 'COMPLETED'
));
create policy reviews_customer_update on public.reviews
for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy salon_settings_member_select on public.salon_settings
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy salon_settings_manage on public.salon_settings
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy audit_logs_owner_select on public.audit_logs
for select to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
-- Audit log inserts should be made by trusted server-side functions.


-- ============================================================
-- FILE: migrations/007_rpc_helpers_and_realtime.sql
-- ============================================================
-- BOOKSALOON | 007: Safe RPC helpers, salon onboarding and queue numbering
-- These are starting primitives. Implement full booking/assignment in a single
-- transactional RPC before allowing customers to create live bookings.

-- Create a salon and automatically link the caller as OWNER.
create or replace function public.create_salon(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Salon name is required'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid salon slug'; end if;

  insert into public.salons (created_by, name, slug, phone, city, state)
  values (auth.uid(), trim(p_name), p_slug, p_phone, p_city, p_state)
  returning id into v_salon_id;

  insert into public.salon_members (salon_id, user_id, role)
  values (v_salon_id, auth.uid(), 'OWNER');

  return v_salon_id;
end;
$$;

revoke all on function public.create_salon(text,text,text,text,text) from public;
grant execute on function public.create_salon(text,text,text,text,text) to authenticated;

-- Generate the next queue number safely for a salon and local queue date.
-- Call within the same transaction that inserts the queue entry.
create or replace function public.next_queue_number(p_salon_id uuid, p_queue_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not public.is_salon_member(p_salon_id) and not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_salon_id::text || ':' || p_queue_date::text, 0)
  );

  select coalesce(max(queue_number), 0) + 1
    into v_next
  from public.queue_entries
  where salon_id = p_salon_id and queue_date = p_queue_date;

  return v_next;
end;
$$;

revoke all on function public.next_queue_number(uuid,date) from public;
grant execute on function public.next_queue_number(uuid,date) to authenticated;

-- Enable Realtime publication for tables whose changes should update clients.
-- Supabase may already have some tables in this publication; duplicate-safe blocks.
do $$
declare t text;
begin
  foreach t in array array['bookings','queue_entries','notifications','chairs','booking_staff','booking_resources'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable Realtime publication in Supabase dashboard later.';
end $$;


-- Customers cancel only their own eligible booking through this narrow RPC.
-- This deliberately does not allow customers to update arbitrary booking columns.
create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_status public.booking_status;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select customer_id, status
    into v_customer_id, v_status
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found'; end if;
  if v_customer_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if v_status not in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED') then
    raise exception 'Booking cannot be cancelled in its current state';
  end if;

  update public.bookings
  set status = 'CANCELLED', updated_at = now()
  where id = p_booking_id;

  update public.booking_staff
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';

  update public.booking_resources
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';

  update public.queue_entries
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status in ('WAITING', 'CALLED');
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;


-- ============================================================
-- FILE: migrations/008_seed_demo_data.sql
-- ============================================================
-- BOOKSALOON | 008: Optional development seed data
-- This seeds salon catalogue data only. It does not create auth users.
-- Replace the placeholder salon UUID below with a real salon ID after onboarding.

-- Example:
-- insert into public.service_categories (salon_id, name, sort_order)
-- values ('00000000-0000-0000-0000-000000000001', 'Hair', 1),
--        ('00000000-0000-0000-0000-000000000001', 'Beard', 2);
--
-- insert into public.services
--   (salon_id, category_id, name, description, price_paise, duration_minutes)
-- values
--   ('00000000-0000-0000-0000-000000000001', '<CATEGORY_UUID>', 'Classic Haircut',
--    'Standard haircut', 20000, 30),
--   ('00000000-0000-0000-0000-000000000001', '<CATEGORY_UUID>', 'Beard Trim',
--    'Beard shaping and trim', 10000, 15);
--
-- Intentionally no fake production users, bookings, or payments are inserted.
-- BOOKSALOON | 012: Transactional booking approval and staff ETA

create or replace function public.create_auto_assigned_booking(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_priority boolean default false
)
returns table (
  booking_id uuid,
  booking_status public.booking_status,
  estimated_wait_minutes integer,
  estimated_start_at timestamptz,
  employee_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_salon_status public.salon_status;
  v_duration integer;
  v_total integer;
  v_start timestamptz;
  v_end timestamptz;
  v_employee_id uuid;
  v_employee_name text;
  v_booking_id uuid;
  v_booking_status public.booking_status;
  v_queue_number integer;
  v_wait integer;
begin
  if v_customer_id is null then raise exception 'Authentication required'; end if;
  if p_salon_id is null or coalesce(array_length(p_service_ids, 1), 0) = 0 then
    raise exception 'Select at least one service';
  end if;

  select status into v_salon_status
  from public.salons
  where id = p_salon_id
  for update;
  if not found then raise exception 'Salon not found'; end if;
  if v_salon_status <> 'ACTIVE' then raise exception 'SALON_CLOSED'; end if;

  select coalesce(sum(s.duration_minutes), 0), coalesce(sum(s.price_paise), 0)
    into v_duration, v_total
  from public.services s
  where s.salon_id = p_salon_id
    and s.id = any(p_service_ids)
    and s.is_active;
  if v_duration = 0 then raise exception 'Selected service is unavailable'; end if;

  select e.id, e.employee_name,
         greatest(now(), coalesce(max(bs.end_at), now()))
    into v_employee_id, v_employee_name, v_start
  from public.employees e
  left join public.booking_staff bs
    on bs.employee_id = e.id
   and bs.status = 'ACTIVE'
   and bs.end_at > now()
  where e.salon_id = p_salon_id
    and e.status = 'ACTIVE'
  group by e.id, e.employee_name
  order by greatest(now(), coalesce(max(bs.end_at), now())), e.created_at
  limit 1
  for update of e;

  if v_employee_id is null then raise exception 'No active staff available'; end if;

  v_end := v_start + make_interval(mins => v_duration + case when p_priority then 0 else 0 end);
  v_wait := greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer);
  v_booking_status := case when v_wait = 0 then 'CONFIRMED' else 'WAITING' end;

  insert into public.bookings (
    salon_id, customer_id, booking_number, booking_type, status,
    scheduled_start, scheduled_end, subtotal_paise, total_paise, payment_status
  )
  values (
    p_salon_id, v_customer_id,
    'BK-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    case when p_priority then 'QUICK_TURN' else 'NORMAL' end,
    v_booking_status, v_start, v_end, v_total, v_total, 'PAY_AT_SALON'
  )
  returning id into v_booking_id;

  insert into public.booking_items (
    salon_id, booking_id, service_id, service_name_snapshot,
    unit_price_paise, duration_minutes
  )
  select p_salon_id, v_booking_id, s.id, s.name, s.price_paise, s.duration_minutes
  from public.services s
  where s.salon_id = p_salon_id and s.id = any(p_service_ids) and s.is_active;

  insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at)
  values (p_salon_id, v_booking_id, v_employee_id, v_start, v_end);

  select public.next_queue_number(p_salon_id, (now() at time zone 'Asia/Kolkata')::date)
    into v_queue_number;
  insert into public.queue_entries (
    salon_id, booking_id, customer_id, queue_date, queue_number,
    estimated_wait_minutes, estimated_start_at
  )
  values (
    p_salon_id, v_booking_id, v_customer_id,
    (now() at time zone 'Asia/Kolkata')::date, v_queue_number,
    v_wait, v_start
  );

  insert into public.notifications (
    user_id, salon_id, booking_id, title, message, notification_type
  )
  values (
    v_customer_id, p_salon_id, v_booking_id,
    case when v_wait = 0 then 'Appointment approved' else 'Appointment queued' end,
    case when v_wait = 0
      then 'Your appointment is approved. ' || v_employee_name || ' is available now.'
      else 'Estimated waiting time is ' || v_wait || ' minutes. Assigned staff: ' || v_employee_name || '.'
    end,
    case when v_wait = 0 then 'BOOKING_CONFIRMED' else 'QUEUE_UPDATE' end
  );

  return query select v_booking_id, v_booking_status, v_wait, v_start, v_employee_name;
end;
$$;

revoke all on function public.create_auto_assigned_booking(uuid, uuid[], boolean) from public;
grant execute on function public.create_auto_assigned_booking(uuid, uuid[], boolean) to authenticated;
-- BOOKSALOON | 012: Transactional booking approval and staff ETA

create or replace function public.create_auto_assigned_booking(
  p_salon_id uuid,
  p_service_ids uuid[],
  p_priority boolean default false
)
returns table (
  booking_id uuid,
  booking_status public.booking_status,
  estimated_wait_minutes integer,
  estimated_start_at timestamptz,
  employee_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid := auth.uid();
  v_salon_status public.salon_status;
  v_duration integer;
  v_total integer;
  v_start timestamptz;
  v_end timestamptz;
  v_employee_id uuid;
  v_employee_name text;
  v_booking_id uuid;
  v_booking_status public.booking_status;
  v_queue_number integer;
  v_wait integer;
begin
  if v_customer_id is null then raise exception 'Authentication required'; end if;
  if p_salon_id is null or coalesce(array_length(p_service_ids, 1), 0) = 0 then
    raise exception 'Select at least one service';
  end if;

  select status into v_salon_status
  from public.salons
  where id = p_salon_id
  for update;
  if not found then raise exception 'Salon not found'; end if;
  if v_salon_status <> 'ACTIVE' then raise exception 'SALON_CLOSED'; end if;

  select coalesce(sum(s.duration_minutes), 0), coalesce(sum(s.price_paise), 0)
    into v_duration, v_total
  from public.services s
  where s.salon_id = p_salon_id
    and s.id = any(p_service_ids)
    and s.is_active;
  if v_duration = 0 then raise exception 'Selected service is unavailable'; end if;

  select e.id, e.employee_name,
         greatest(now(), coalesce(max(bs.end_at), now()))
    into v_employee_id, v_employee_name, v_start
  from public.employees e
  left join public.booking_staff bs
    on bs.employee_id = e.id
   and bs.status = 'ACTIVE'
   and bs.end_at > now()
  where e.salon_id = p_salon_id
    and e.status = 'ACTIVE'
  group by e.id, e.employee_name
  order by greatest(now(), coalesce(max(bs.end_at), now())), e.created_at
  limit 1
  for update of e;

  if v_employee_id is null then raise exception 'No active staff available'; end if;

  v_end := v_start + make_interval(mins => v_duration + case when p_priority then 0 else 0 end);
  v_wait := greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer);
  v_booking_status := case when v_wait = 0 then 'CONFIRMED' else 'WAITING' end;

  insert into public.bookings (
    salon_id, customer_id, booking_number, booking_type, status,
    scheduled_start, scheduled_end, subtotal_paise, total_paise, payment_status
  )
  values (
    p_salon_id, v_customer_id,
    'BK-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    case when p_priority then 'QUICK_TURN' else 'NORMAL' end,
    v_booking_status, v_start, v_end, v_total, v_total, 'PAY_AT_SALON'
  )
  returning id into v_booking_id;

  insert into public.booking_items (
    salon_id, booking_id, service_id, service_name_snapshot,
    unit_price_paise, duration_minutes
  )
  select p_salon_id, v_booking_id, s.id, s.name, s.price_paise, s.duration_minutes
  from public.services s
  where s.salon_id = p_salon_id and s.id = any(p_service_ids) and s.is_active;

  insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at)
  values (p_salon_id, v_booking_id, v_employee_id, v_start, v_end);

  perform pg_advisory_xact_lock(
    hashtextextended(p_salon_id::text || ':' || ((now() at time zone 'Asia/Kolkata')::date)::text, 0)
  );
  select coalesce(max(queue_number), 0) + 1
    into v_queue_number
  from public.queue_entries
  where salon_id = p_salon_id
    and queue_date = (now() at time zone 'Asia/Kolkata')::date;
  insert into public.queue_entries (
    salon_id, booking_id, customer_id, queue_date, queue_number,
    estimated_wait_minutes, estimated_start_at
  )
  values (
    p_salon_id, v_booking_id, v_customer_id,
    (now() at time zone 'Asia/Kolkata')::date, v_queue_number,
    v_wait, v_start
  );

  insert into public.notifications (
    user_id, salon_id, booking_id, title, message, notification_type
  )
  values (
    v_customer_id, p_salon_id, v_booking_id,
    case when v_wait = 0 then 'Appointment approved' else 'Appointment queued' end,
    case when v_wait = 0
      then 'Your appointment is approved. ' || v_employee_name || ' is available now.'
      else 'Estimated waiting time is ' || v_wait || ' minutes. Assigned staff: ' || v_employee_name || '.'
    end,
    case when v_wait = 0 then 'BOOKING_CONFIRMED' else 'QUEUE_UPDATE' end
  );

  return query select v_booking_id, v_booking_status, v_wait, v_start, v_employee_name;
end;
$$;

revoke all on function public.create_auto_assigned_booking(uuid, uuid[], boolean) from public;
grant execute on function public.create_auto_assigned_booking(uuid, uuid[], boolean) to authenticated;
