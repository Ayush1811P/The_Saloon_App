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
