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
