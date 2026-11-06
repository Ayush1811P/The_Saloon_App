-- Keep customer bookings waiting unless an eligible barber is truly available.
-- Reassert location fields for projects where migration 019 was not applied.

alter table public.salons
  add column if not exists location_description text,
  add column if not exists location_source text,
  add column if not exists location_updated_at timestamptz;

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
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if v_customer_id is null then raise exception 'Authentication required'; end if;
  if p_salon_id is null or coalesce(array_length(p_service_ids, 1), 0) = 0 then
    raise exception 'Select at least one service';
  end if;

  select status into v_salon_status
  from public.salons where id = p_salon_id for update;
  if not found then raise exception 'Salon not found'; end if;
  if v_salon_status <> 'ACTIVE' then raise exception 'SALON_CLOSED'; end if;

  select coalesce(sum(s.duration_minutes), 0), coalesce(sum(s.price_paise), 0)
    into v_duration, v_total
  from public.services s
  where s.salon_id = p_salon_id
    and s.id = any(p_service_ids)
    and s.is_active;
  if v_duration = 0 or (
    select count(distinct s.id)
    from public.services s
    where s.salon_id = p_salon_id and s.id = any(p_service_ids) and s.is_active
  ) <> (select count(distinct id) from unnest(p_service_ids) as requested(id)) then
    raise exception 'One or more selected services are unavailable';
  end if;

  select e.id, e.employee_name
    into v_employee_id, v_employee_name
  from public.employees e
  where e.salon_id = p_salon_id
    and e.status = 'ACTIVE'
    and not exists (
      select 1 from public.employee_floor_status fs
      where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
    )
    and not exists (
      select 1 from public.employee_leaves l
      where l.employee_id = e.id and l.status = 'APPROVED'
        and tstzrange(l.start_at, l.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id
        and tstzrange(b.start_at, b.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
          and sh.is_working and sh.start_at <= now()
          and sh.end_at >= now() + make_interval(mins => v_duration)
      )
    )
    and (
      not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
      or not exists (
        select 1 from unnest(p_service_ids) requested(id)
        where not exists (
          select 1 from public.employee_skills es
          where es.employee_id = e.id and es.service_id = requested.id
        )
      )
    )
    and not exists (
      select 1 from public.booking_staff bs
      where bs.employee_id = e.id and bs.status = 'ACTIVE'
        and tstzrange(bs.start_at, bs.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
  order by e.created_at
  limit 1
  for update of e;

  if v_employee_id is not null then
    v_start := now();
    v_booking_status := 'CONFIRMED';
    v_wait := 0;
  else
    v_booking_status := 'WAITING';
    select min(bs.end_at) into v_start
    from public.booking_staff bs
    join public.employees e on e.id = bs.employee_id
    where e.salon_id = p_salon_id
      and e.status = 'ACTIVE'
      and bs.status = 'ACTIVE'
      and bs.end_at > now()
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      )
      and not exists (
        select 1 from public.employee_leaves l
        where l.employee_id = e.id and l.status = 'APPROVED'
          and tstzrange(l.start_at, l.end_at, '[)')
              && tstzrange(bs.end_at, bs.end_at + make_interval(mins => v_duration), '[)')
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id
          and tstzrange(b.start_at, b.end_at, '[)')
              && tstzrange(bs.end_at, bs.end_at + make_interval(mins => v_duration), '[)')
      )
      and (
        not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = v_today
            and sh.is_working and sh.start_at <= bs.end_at
            and sh.end_at >= bs.end_at + make_interval(mins => v_duration)
        )
      )
      and (
        not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or not exists (
          select 1 from unnest(p_service_ids) requested(id)
          where not exists (
            select 1 from public.employee_skills es
            where es.employee_id = e.id and es.service_id = requested.id
          )
        )
      );
    v_wait := case when v_start is null then null
      else greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer)
    end;
  end if;

  v_start := coalesce(v_start, now());
  v_end := v_start + make_interval(mins => v_duration);

  insert into public.bookings (
    salon_id, customer_id, booking_number, booking_type, status,
    scheduled_start, scheduled_end, subtotal_paise, total_paise, payment_status
  )
  values (
    p_salon_id, v_customer_id,
    'BK-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    case when p_priority then 'QUICK_TURN'::public.booking_type else 'NORMAL'::public.booking_type end,
    case when v_booking_status = 'CONFIRMED' then 'PENDING'::public.booking_status else v_booking_status end,
    v_start, v_end, v_total, v_total, 'PAY_AT_SALON'
  )
  returning id into v_booking_id;

  insert into public.booking_items (
    salon_id, booking_id, service_id, service_name_snapshot,
    unit_price_paise, duration_minutes
  )
  select p_salon_id, v_booking_id, s.id, s.name, s.price_paise, s.duration_minutes
  from public.services s
  where s.salon_id = p_salon_id and s.id = any(p_service_ids) and s.is_active;

  if v_employee_id is not null then
    insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at)
    values (p_salon_id, v_booking_id, v_employee_id, v_start, v_end);
    update public.bookings set status = 'CONFIRMED', updated_at = now()
    where id = v_booking_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_salon_id::text || ':' || v_today::text, 0));
  select coalesce(max(queue_number), 0) + 1 into v_queue_number
  from public.queue_entries where salon_id = p_salon_id and queue_date = v_today;
  insert into public.queue_entries (
    salon_id, booking_id, customer_id, queue_date, queue_number,
    estimated_wait_minutes, estimated_start_at
  )
  values (
    p_salon_id, v_booking_id, v_customer_id, v_today, v_queue_number, v_wait,
    case when v_wait is null then null else v_start end
  );

  if v_booking_status <> 'CONFIRMED' then
    insert into public.notifications (user_id, salon_id, booking_id, title, message, notification_type)
    values (
      v_customer_id, p_salon_id, v_booking_id, 'Appointment in queue',
      case when v_wait is null
        then 'No eligible barber is currently available. Your appointment is queued and the wait time is unknown.'
        else 'Estimated waiting time: ' || v_wait || ' minutes.'
      end,
      'QUEUE_UPDATE'
    );
  end if;

  return query select v_booking_id, v_booking_status, v_wait,
    case when v_wait is null then null else v_start end, v_employee_name;
end;
$$;

revoke all on function public.create_auto_assigned_booking(uuid, uuid[], boolean) from public, anon;
grant execute on function public.create_auto_assigned_booking(uuid, uuid[], boolean) to authenticated;

create or replace function public.admin_approve_booking(p_booking_id uuid)
returns public.booking_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_employee_id uuid;
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_queue_number integer;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  perform public.assert_floor_admin(v_booking.salon_id);
  perform 1 from public.salons where id = v_booking.salon_id for update;
  if v_booking.status not in ('PENDING', 'WAITING', 'BARBER_ASSIGNED') then
    raise exception 'Appointment cannot be approved in its current state';
  end if;

  select coalesce(sum(bi.duration_minutes * bi.quantity), 0)
    into v_duration
  from public.booking_items bi where bi.booking_id = p_booking_id;
  if v_duration <= 0 then raise exception 'Appointment has no valid services'; end if;

  if v_booking.customer_id is not null and not exists (
    select 1 from public.queue_entries qe where qe.booking_id = p_booking_id
  ) then
    perform pg_advisory_xact_lock(hashtextextended(v_booking.salon_id::text || ':' || v_today::text, 0));
    select coalesce(max(qe.queue_number), 0) + 1 into v_queue_number
    from public.queue_entries qe
    where qe.salon_id = v_booking.salon_id and qe.queue_date = v_today;
    insert into public.queue_entries (
      salon_id, booking_id, customer_id, queue_date, queue_number
    ) values (
      v_booking.salon_id, p_booking_id, v_booking.customer_id, v_today, v_queue_number
    );
  end if;

  select e.id into v_employee_id
  from public.employees e
  where e.salon_id = v_booking.salon_id
    and e.status = 'ACTIVE'
    and not exists (
      select 1 from public.employee_floor_status fs
      where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
    )
    and not exists (
      select 1 from public.employee_leaves l
      where l.employee_id = e.id and l.status = 'APPROVED'
        and tstzrange(l.start_at, l.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id
        and tstzrange(b.start_at, b.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
          and sh.is_working and sh.start_at <= now()
          and sh.end_at >= now() + make_interval(mins => v_duration)
      )
    )
    and (
      not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
      or not exists (
        select 1 from public.booking_items bi
        where bi.booking_id = p_booking_id and bi.service_id is not null
          and not exists (
            select 1 from public.employee_skills es
            where es.employee_id = e.id and es.service_id = bi.service_id
          )
      )
    )
    and not exists (
      select 1 from public.booking_staff bs
      where bs.employee_id = e.id and bs.status = 'ACTIVE'
        and tstzrange(bs.start_at, bs.end_at, '[)')
            && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
    )
  order by e.created_at
  limit 1
  for update of e;

  if v_employee_id is not null then
    v_start := now();
    v_end := v_start + make_interval(mins => v_duration);
    update public.booking_staff set status = 'CANCELLED'
    where booking_id = p_booking_id and status = 'ACTIVE';
    insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at, assignment_type)
    values (v_booking.salon_id, p_booking_id, v_employee_id, v_start, v_end, 'AUTOMATIC');
    update public.bookings set status = 'CONFIRMED', scheduled_start = v_start,
      scheduled_end = v_end, updated_at = now() where id = p_booking_id;
    update public.queue_entries set estimated_wait_minutes = 0, estimated_start_at = v_start
    where booking_id = p_booking_id and status = 'WAITING';
    return 'CONFIRMED';
  end if;

  update public.booking_staff set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';
  select min(bs.end_at) into v_start
  from public.booking_staff bs
  join public.employees e on e.id = bs.employee_id
  where e.salon_id = v_booking.salon_id and e.status = 'ACTIVE'
    and bs.status = 'ACTIVE' and bs.end_at > now()
    and not exists (
      select 1 from public.employee_floor_status fs
      where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
    )
    and not exists (
      select 1 from public.employee_leaves l
      where l.employee_id = e.id and l.status = 'APPROVED'
        and tstzrange(l.start_at, l.end_at, '[)')
            && tstzrange(bs.end_at, bs.end_at + make_interval(mins => v_duration), '[)')
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id
        and tstzrange(b.start_at, b.end_at, '[)')
            && tstzrange(bs.end_at, bs.end_at + make_interval(mins => v_duration), '[)')
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
            and sh.is_working and sh.start_at <= bs.end_at
            and sh.end_at >= bs.end_at + make_interval(mins => v_duration)
        )
    )
    and (
      not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
      or not exists (
        select 1 from public.booking_items bi
        where bi.booking_id = p_booking_id and bi.service_id is not null
          and not exists (
            select 1 from public.employee_skills es
            where es.employee_id = e.id and es.service_id = bi.service_id
          )
      )
    );
  update public.bookings set status = 'WAITING',
    scheduled_start = coalesce(v_start, now()),
    scheduled_end = coalesce(v_start, now()) + make_interval(mins => v_duration),
    updated_at = now()
  where id = p_booking_id;
  update public.queue_entries set
    estimated_wait_minutes = case when v_start is null then null
      else greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer) end,
    estimated_start_at = v_start
  where booking_id = p_booking_id and status = 'WAITING';
  return 'WAITING';
end;
$$;

revoke all on function public.admin_approve_booking(uuid) from public, anon;
grant execute on function public.admin_approve_booking(uuid) to authenticated;

create or replace function public.clear_customer_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.notifications where user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.clear_customer_notifications() from public, anon;
grant execute on function public.clear_customer_notifications() to authenticated;

create or replace function public.clear_admin_salon_notifications(p_salon_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_admin()
    and not public.has_salon_role(p_salon_id, array['OWNER', 'ADMIN']::public.member_role[]) then
    raise exception 'Not authorized to clear this salon notifications';
  end if;
  delete from public.notifications where salon_id = p_salon_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.clear_admin_salon_notifications(uuid) from public, anon;
grant execute on function public.clear_admin_salon_notifications(uuid) to authenticated;
