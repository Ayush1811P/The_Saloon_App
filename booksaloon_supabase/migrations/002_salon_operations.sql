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
