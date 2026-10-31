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
