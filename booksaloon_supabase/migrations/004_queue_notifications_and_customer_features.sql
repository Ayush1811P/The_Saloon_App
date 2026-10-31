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
