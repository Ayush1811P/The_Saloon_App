-- BOOKSALOON | 009: Tenant integrity hardening
-- Apply after migrations 001-007. No production/demo data is inserted.

-- A salon member may update operational booking fields, but cannot move a
-- booking to another customer or salon through the authenticated API.
create or replace function public.guard_booking_tenant_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    new.salon_id is distinct from old.salon_id
    or new.customer_id is distinct from old.customer_id
  ) then
    raise exception 'Booking salon and customer cannot be changed';
  end if;
  return new;
end;
$$;

create trigger bookings_tenant_identity_guard
before update on public.bookings
for each row execute function public.guard_booking_tenant_identity();

-- Schedule rows must belong to the same salon as their employee.
create trigger employee_shifts_salon_guard
before insert or update on public.employee_shifts
for each row execute function public.assert_staff_salon();

create trigger employee_breaks_salon_guard
before insert or update on public.employee_breaks
for each row execute function public.assert_staff_salon();

create trigger employee_leaves_salon_guard
before insert or update on public.employee_leaves
for each row execute function public.assert_staff_salon();

create or replace function public.assert_queue_customer_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_customer_id uuid;
begin
  select b.customer_id
    into v_customer_id
  from public.bookings b
  where b.id = new.booking_id
    and b.salon_id = new.salon_id;

  if not found or v_customer_id is distinct from new.customer_id then
    raise exception 'Queue customer and salon must match the booking';
  end if;
  return new;
end;
$$;

create trigger queue_entries_customer_guard
before insert or update on public.queue_entries
for each row execute function public.assert_queue_customer_booking();

create or replace function public.assert_coupon_offer_salon()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_id is not null and not exists (
    select 1
    from public.offers o
    where o.id = new.offer_id
      and o.salon_id = new.salon_id
  ) then
    raise exception 'Offer does not belong to this salon';
  end if;
  return new;
end;
$$;

create trigger coupons_offer_salon_guard
before insert or update on public.coupons
for each row execute function public.assert_coupon_offer_salon();

create or replace function public.assert_review_booking_and_employee_salon()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_booking_customer_id uuid;
  v_booking_status public.booking_status;
begin
  select b.customer_id, b.status
    into v_booking_customer_id, v_booking_status
  from public.bookings b
  where b.id = new.booking_id
    and b.salon_id = new.salon_id;

  if not found
    or v_booking_customer_id is distinct from new.customer_id
    or v_booking_status <> 'COMPLETED' then
    raise exception 'Review must match the customer salon and a completed booking';
  end if;

  if new.employee_id is not null and not exists (
    select 1
    from public.employees e
    where e.id = new.employee_id
      and e.salon_id = new.salon_id
  ) then
    raise exception 'Review employee does not belong to this salon';
  end if;
  return new;
end;
$$;

create trigger reviews_booking_employee_guard
before insert or update on public.reviews
for each row execute function public.assert_review_booking_and_employee_salon();
