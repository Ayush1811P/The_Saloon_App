-- BOOKSALOON | 013: Live salon floor and walk-in operations

alter table public.bookings alter column customer_id drop not null;
alter table public.bookings add column if not exists customer_name_snapshot text;
alter table public.bookings add column if not exists customer_phone_snapshot text;
alter table public.queue_entries alter column customer_id drop not null;
alter table public.queue_entries add column if not exists customer_name_snapshot text;
alter table public.queue_entries add column if not exists customer_phone_snapshot text;

create table if not exists public.employee_floor_status (
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid primary key references public.employees(id) on delete cascade,
  status text not null default 'AVAILABLE'
    check (status in ('AVAILABLE', 'BREAK', 'OFFLINE')),
  updated_at timestamptz not null default now()
);

create index if not exists employee_floor_status_salon_idx
  on public.employee_floor_status(salon_id, status);

alter table public.employee_floor_status enable row level security;
drop policy if exists employee_floor_status_member_select on public.employee_floor_status;
create policy employee_floor_status_member_select on public.employee_floor_status
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
drop policy if exists employee_floor_status_manage on public.employee_floor_status;
create policy employee_floor_status_manage on public.employee_floor_status
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create or replace function public.assert_floor_admin(p_salon_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or (
    not public.has_salon_role(p_salon_id, array['OWNER','ADMIN']::public.member_role[])
    and not public.is_platform_admin()
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

create or replace function public.refresh_salon_floor_queue(p_salon_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_start timestamptz;
  v_wait integer;
begin
  perform public.assert_floor_admin(p_salon_id);
  for r in
    select qe.id, qe.queue_number
    from public.queue_entries qe
    where qe.salon_id = p_salon_id
      and qe.queue_date = (now() at time zone 'Asia/Kolkata')::date
      and qe.status = 'WAITING'
    order by qe.queue_number
  loop
    select greatest(
      now(),
      coalesce(min(bs.end_at), now())
    ) into v_start
    from public.employees e
    left join public.booking_staff bs
      on bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now()
    where e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      );
    v_wait := greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer);
    update public.queue_entries
    set estimated_wait_minutes = v_wait,
        estimated_start_at = v_start
    where id = r.id;
  end loop;
end;
$$;

create or replace function public.create_walkin_booking(
  p_salon_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_service_id uuid default null,
  p_preferred_employee_id uuid default null,
  p_assignment_mode text default 'QUEUE'
)
returns table (booking_id uuid, booking_status public.booking_status, queue_number integer, assigned_employee_name text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_service public.services%rowtype;
  v_employee_id uuid;
  v_employee_name text;
  v_start timestamptz := now();
  v_end timestamptz;
  v_status public.booking_status := 'WAITING';
  v_queue_status public.queue_status := 'WAITING';
  v_queue_number integer;
  v_booking_id uuid;
  v_queue_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.assert_floor_admin(p_salon_id);
  if length(trim(coalesce(p_customer_name, ''))) < 2 then raise exception 'Customer name is required'; end if;
  if p_assignment_mode not in ('AUTO', 'MANUAL', 'QUEUE') then raise exception 'Invalid assignment mode'; end if;

  select * into v_service from public.services
  where id = p_service_id and salon_id = p_salon_id and is_active;
  if not found then raise exception 'Selected service is unavailable'; end if;

  if nullif(trim(p_customer_phone), '') is not null then
    select id into v_customer_id from public.profiles
    where phone = trim(p_customer_phone) limit 1;
  end if;

  if p_assignment_mode <> 'QUEUE' then
    if p_assignment_mode = 'MANUAL' then
      v_employee_id := p_preferred_employee_id;
    else
      select e.id into v_employee_id
      from public.employees e
      where e.salon_id = p_salon_id and e.status = 'ACTIVE'
        and not exists (select 1 from public.employee_floor_status fs where fs.employee_id = e.id and fs.status in ('BREAK','OFFLINE'))
        and not exists (select 1 from public.employee_leaves l where l.employee_id = e.id and l.status = 'APPROVED' and now() between l.start_at and l.end_at)
        and (not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
          or exists (select 1 from public.employee_skills es where es.employee_id = e.id and es.service_id = p_service_id))
        and not exists (select 1 from public.booking_staff bs where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now())
        and not exists (select 1 from public.booking_staff bs where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now())
      order by e.created_at limit 1;
    end if;
    if v_employee_id is null then raise exception 'No eligible barber is available'; end if;
    if not exists (
      select 1 from public.employees e
      where e.id = v_employee_id and e.salon_id = p_salon_id and e.status = 'ACTIVE'
        and not exists (select 1 from public.employee_floor_status fs where fs.employee_id = e.id and fs.status in ('BREAK','OFFLINE'))
        and (not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
          or exists (select 1 from public.employee_skills es where es.employee_id = e.id and es.service_id = p_service_id))
    ) then raise exception 'Barber is unavailable or not qualified'; end if;
    select employee_name into v_employee_name from public.employees where id = v_employee_id;
    v_status := 'IN_PROGRESS';
    v_queue_status := 'SERVING';
    v_end := v_start + make_interval(mins => v_service.duration_minutes + v_service.buffer_minutes);
  else
    v_end := v_start + make_interval(mins => v_service.duration_minutes);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_salon_id::text || ':' || v_queue_date::text, 0));
  select coalesce(max(qe.queue_number), 0) + 1 into v_queue_number
  from public.queue_entries qe
  where qe.salon_id = p_salon_id and qe.queue_date = v_queue_date;

  insert into public.bookings (
    salon_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
    booking_number, booking_type, status, scheduled_start, scheduled_end,
    actual_start, subtotal_paise, total_paise, payment_status
  ) values (
    p_salon_id, v_customer_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''),
    'WI-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    'WALK_IN', v_status, v_start, v_end,
    case when v_status = 'IN_PROGRESS' then v_start end,
    v_service.price_paise, v_service.price_paise, 'PAY_AT_SALON'
  ) returning id into v_booking_id;

  insert into public.booking_items (salon_id, booking_id, service_id, service_name_snapshot, unit_price_paise, duration_minutes)
  values (p_salon_id, v_booking_id, v_service.id, v_service.name, v_service.price_paise, v_service.duration_minutes);
  insert into public.queue_entries (
    salon_id, booking_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
    queue_date, queue_number, estimated_wait_minutes, estimated_start_at, status, service_started_at
  ) values (
    p_salon_id, v_booking_id, v_customer_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''),
    v_queue_date, v_queue_number, case when v_status = 'IN_PROGRESS' then 0 else null end,
    case when v_status = 'IN_PROGRESS' then v_start end, v_queue_status,
    case when v_status = 'IN_PROGRESS' then v_start end
  );
  if v_employee_id is not null then
    insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at, assignment_type)
    values (p_salon_id, v_booking_id, v_employee_id, v_start, v_end, case when p_assignment_mode = 'MANUAL' then 'MANUAL' else 'AUTOMATIC' end);
  end if;
  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id, new_values)
  values (p_salon_id, auth.uid(), 'CREATE_WALKIN', 'BOOKING', v_booking_id,
    jsonb_build_object('customer_name', trim(p_customer_name), 'assignment_mode', p_assignment_mode));
  perform public.refresh_salon_floor_queue(p_salon_id);
  return query select v_booking_id, v_status, v_queue_number, v_employee_name;
end;
$$;

create or replace function public.complete_service(p_salon_id uuid, p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_floor_admin(p_salon_id);
  if not exists (select 1 from public.bookings where id = p_booking_id and salon_id = p_salon_id for update) then raise exception 'Booking not found'; end if;
  update public.bookings set status = 'COMPLETED', actual_end = now() where id = p_booking_id and status = 'IN_PROGRESS';
  update public.booking_staff set status = 'RELEASED', end_at = least(end_at, now()) where booking_id = p_booking_id and status = 'ACTIVE';
  update public.queue_entries set status = 'COMPLETED', completed_at = now() where booking_id = p_booking_id and status in ('SERVING','CALLED');
  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id) values (p_salon_id, auth.uid(), 'COMPLETE_SERVICE', 'BOOKING', p_booking_id);
  perform public.refresh_salon_floor_queue(p_salon_id);
end;
$$;

create or replace function public.assign_waiting_customer(
  p_salon_id uuid,
  p_booking_id uuid,
  p_employee_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_duration integer;
  v_service_id uuid;
  v_start timestamptz := now();
  v_end timestamptz;
begin
  perform public.assert_floor_admin(p_salon_id);
  select bi.service_id, bi.duration_minutes into v_service_id, v_duration
  from public.booking_items bi
  join public.bookings b on b.id = bi.booking_id and b.salon_id = p_salon_id
  where bi.booking_id = p_booking_id order by bi.created_at limit 1;
  if v_service_id is null then raise exception 'Booking service not found'; end if;
  if not exists (
    select 1 from public.queue_entries where booking_id = p_booking_id and status in ('WAITING','CALLED')
  ) then raise exception 'Customer is not waiting'; end if;
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (select 1 from public.employee_floor_status fs where fs.employee_id = e.id and fs.status in ('BREAK','OFFLINE'))
      and not exists (select 1 from public.booking_staff bs where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now())
      and (not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or exists (select 1 from public.employee_skills es where es.employee_id = e.id and es.service_id = v_service_id))
  ) then raise exception 'Barber is unavailable or not qualified'; end if;
  v_end := v_start + make_interval(mins => v_duration);
  insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at, assignment_type)
  values (p_salon_id, p_booking_id, p_employee_id, v_start, v_end, 'MANUAL');
  update public.bookings set status = 'IN_PROGRESS', actual_start = v_start where id = p_booking_id;
  update public.queue_entries set status = 'SERVING', service_started_at = v_start, estimated_wait_minutes = 0, estimated_start_at = v_start where booking_id = p_booking_id;
  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id) values (p_salon_id, auth.uid(), 'ASSIGN_WAITING_CUSTOMER', 'BOOKING', p_booking_id);
  perform public.refresh_salon_floor_queue(p_salon_id);
end;
$$;

create or replace function public.update_staff_availability(p_salon_id uuid, p_employee_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_floor_admin(p_salon_id);
  if p_status not in ('AVAILABLE','BREAK','OFFLINE') then raise exception 'Invalid staff status'; end if;
  if not exists (select 1 from public.employees where id = p_employee_id and salon_id = p_salon_id) then raise exception 'Employee not found'; end if;
  if p_status = 'AVAILABLE' and exists (select 1 from public.booking_staff where employee_id = p_employee_id and status = 'ACTIVE' and end_at > now()) then
    raise exception 'Complete the active service before marking this barber available';
  end if;
  insert into public.employee_floor_status (salon_id, employee_id, status)
  values (p_salon_id, p_employee_id, p_status)
  on conflict (employee_id) do update set status = excluded.status, updated_at = now();
  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id, new_values)
  values (p_salon_id, auth.uid(), 'UPDATE_STAFF_AVAILABILITY', 'EMPLOYEE', p_employee_id, jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.cancel_walkin_booking(p_salon_id uuid, p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.assert_floor_admin(p_salon_id);
  update public.bookings set status = 'CANCELLED' where id = p_booking_id and salon_id = p_salon_id and status not in ('COMPLETED','CANCELLED');
  if not found then raise exception 'Booking cannot be cancelled'; end if;
  update public.booking_staff set status = 'CANCELLED' where booking_id = p_booking_id and status = 'ACTIVE';
  update public.queue_entries set status = 'CANCELLED' where booking_id = p_booking_id and status in ('WAITING','CALLED','SERVING');
  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id) values (p_salon_id, auth.uid(), 'CANCEL_WALKIN', 'BOOKING', p_booking_id);
  perform public.refresh_salon_floor_queue(p_salon_id);
end;
$$;

revoke all on function public.create_walkin_booking(uuid,text,text,uuid,uuid,text) from public;
revoke all on function public.complete_service(uuid,uuid) from public;
revoke all on function public.assign_waiting_customer(uuid,uuid,uuid) from public;
revoke all on function public.update_staff_availability(uuid,uuid,text) from public;
revoke all on function public.cancel_walkin_booking(uuid,uuid) from public;
revoke all on function public.refresh_salon_floor_queue(uuid) from public;
grant execute on function public.create_walkin_booking(uuid,text,text,uuid,uuid,text) to authenticated;
grant execute on function public.complete_service(uuid,uuid) to authenticated;
grant execute on function public.assign_waiting_customer(uuid,uuid,uuid) to authenticated;
grant execute on function public.update_staff_availability(uuid,uuid,text) to authenticated;
grant execute on function public.cancel_walkin_booking(uuid,uuid) to authenticated;
grant execute on function public.refresh_salon_floor_queue(uuid) to authenticated;
