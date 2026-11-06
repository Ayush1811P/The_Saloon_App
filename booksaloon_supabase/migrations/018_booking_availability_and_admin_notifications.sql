-- Respect real staff availability for booking approval and let salon admins
-- clear/read their salon notifications.

drop policy if exists notifications_admin_select on public.notifications;
create policy notifications_admin_select on public.notifications
for select to authenticated
using (
  public.is_platform_admin()
  or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[])
);

drop policy if exists notifications_admin_update on public.notifications;
create policy notifications_admin_update on public.notifications
for update to authenticated
using (
  public.is_platform_admin()
  or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[])
)
with check (
  public.is_platform_admin()
  or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[])
);

drop policy if exists notifications_admin_delete on public.notifications;
create policy notifications_admin_delete on public.notifications
for delete to authenticated
using (
  public.is_platform_admin()
  or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[])
);

create or replace function public.notify_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wait integer;
  v_title text;
  v_message text;
  v_type public.notification_type := 'GENERAL';
begin
  if new.customer_id is null or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'CONFIRMED' then
    v_title := 'Appointment approved';
    v_message := 'Your appointment has been approved and assigned to a barber.';
    v_type := 'BOOKING_CONFIRMED';
  elsif new.status in ('WAITING', 'BARBER_ASSIGNED') then
    select estimated_wait_minutes into v_wait
    from public.queue_entries where booking_id = new.id;
    v_title := 'Appointment in queue';
    v_message := case when v_wait is null
      then 'Your appointment is in the queue. The waiting time will be updated when a barber is available.'
      else 'Your appointment is in the queue. Estimated wait: ' || v_wait || ' minutes.'
    end;
    v_type := 'QUEUE_UPDATE';
  elsif new.status = 'CANCELLED' then
    v_title := 'Appointment cancelled';
    v_message := 'Your appointment has been cancelled.';
    v_type := 'BOOKING_CANCELLED';
  elsif new.status = 'IN_PROGRESS' then
    v_title := 'Your service has started';
    v_message := 'Your barber has started your service.';
  elsif new.status = 'COMPLETED' then
    v_title := 'Service completed';
    v_message := 'Your salon service is complete. Thank you.';
  else
    return new;
  end if;

  insert into public.notifications (user_id, salon_id, booking_id, title, message, notification_type)
  values (new.customer_id, new.salon_id, new.id, v_title, v_message, v_type);
  return new;
end;
$$;

drop trigger if exists booking_status_customer_notification on public.bookings;
create trigger booking_status_customer_notification
after update of status on public.bookings
for each row execute function public.notify_booking_status_change();

create or replace function public.guard_booking_confirmation_availability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1
       from public.booking_staff bs
       join public.employees e on e.id = bs.employee_id
       where bs.booking_id = new.id
         and bs.salon_id = new.salon_id
         and bs.status = 'ACTIVE'
         and bs.start_at <= now()
         and bs.end_at > now()
         and e.status = 'ACTIVE'
         and not exists (
           select 1 from public.employee_floor_status fs
           where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
         )
         and not exists (
           select 1 from public.employee_leaves l
           where l.employee_id = e.id and l.status = 'APPROVED'
             and now() between l.start_at and l.end_at
         )
         and not exists (
           select 1 from public.employee_breaks b
           where b.employee_id = e.id and now() between b.start_at and b.end_at
         )
         and (
           not exists (
             select 1 from public.employee_shifts sh
             where sh.employee_id = e.id
               and sh.shift_date = (now() at time zone 'Asia/Kolkata')::date
           )
           or exists (
             select 1 from public.employee_shifts sh
             where sh.employee_id = e.id
               and sh.shift_date = (now() at time zone 'Asia/Kolkata')::date
               and sh.is_working and now() between sh.start_at and sh.end_at
           )
         )
         and (
           not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
           or not exists (
             select 1 from public.booking_items bi
             where bi.booking_id = new.id and bi.service_id is not null
               and not exists (
                 select 1 from public.employee_skills es
                 where es.employee_id = e.id and es.service_id = bi.service_id
               )
           )
         )
     ) then
    raise exception 'A currently available, qualified barber must be assigned before approval';
  end if;
  return new;
end;
$$;

drop trigger if exists booking_confirmation_requires_available_barber on public.bookings;
create trigger booking_confirmation_requires_available_barber
before insert or update of status on public.bookings
for each row execute function public.guard_booking_confirmation_availability();

create or replace function public.create_walkin_booking(
  p_salon_id uuid,
  p_customer_name text,
  p_customer_phone text default null,
  p_service_id uuid default null,
  p_preferred_employee_id uuid default null,
  p_assignment_mode text default 'QUEUE'
)
returns table (
  booking_id uuid,
  booking_status public.booking_status,
  queue_number integer,
  assigned_employee_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_customer_name text := coalesce(nullif(trim(p_customer_name), ''), 'Walk-in');
  v_service public.services%rowtype;
  v_employee_id uuid;
  v_employee_name text;
  v_start timestamptz := now();
  v_end timestamptz;
  v_estimated_start timestamptz;
  v_wait integer;
  v_duration integer;
  v_status public.booking_status := 'WAITING';
  v_queue_status public.queue_status := 'WAITING';
  v_queue_number integer;
  v_booking_id uuid;
  v_queue_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform public.assert_floor_admin(p_salon_id);
  if p_assignment_mode not in ('AUTO', 'MANUAL', 'QUEUE') then
    raise exception 'Invalid assignment mode';
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and salon_id = p_salon_id and is_active;
  if not found then raise exception 'Selected service is unavailable'; end if;
  v_duration := v_service.duration_minutes + v_service.buffer_minutes;

  if nullif(trim(p_customer_phone), '') is not null then
    select id into v_customer_id
    from public.profiles
    where phone = trim(p_customer_phone)
    limit 1;
  end if;

  if p_assignment_mode = 'MANUAL' then
    v_employee_id := p_preferred_employee_id;
    if v_employee_id is null then raise exception 'Select an available barber'; end if;
  elsif p_assignment_mode = 'AUTO' then
    select e.id into v_employee_id
    from public.employees e
    where e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      )
      and not exists (
        select 1 from public.employee_leaves l
        where l.employee_id = e.id and l.status = 'APPROVED'
          and now() between l.start_at and l.end_at
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id and now() between b.start_at and b.end_at
      )
      and (
        not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_queue_date)
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = v_queue_date
            and sh.is_working and now() between sh.start_at and sh.end_at
        )
      )
      and (
        not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or exists (
          select 1 from public.employee_skills es
          where es.employee_id = e.id and es.service_id = p_service_id
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
  end if;

  if p_assignment_mode = 'MANUAL' and v_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = v_employee_id and e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      )
      and not exists (
        select 1 from public.employee_leaves l
        where l.employee_id = e.id and l.status = 'APPROVED'
          and now() between l.start_at and l.end_at
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id and now() between b.start_at and b.end_at
      )
      and (
        not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_queue_date)
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = v_queue_date
            and sh.is_working and now() between sh.start_at and sh.end_at
        )
      )
      and (
        not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or exists (
          select 1 from public.employee_skills es
          where es.employee_id = e.id and es.service_id = p_service_id
        )
      )
      and not exists (
        select 1 from public.booking_staff bs
        where bs.employee_id = e.id and bs.status = 'ACTIVE'
          and tstzrange(bs.start_at, bs.end_at, '[)')
              && tstzrange(now(), now() + make_interval(mins => v_duration), '[)')
      )
  ) then
    raise exception 'Barber is unavailable or not qualified';
  end if;

  if v_employee_id is not null then
    select employee_name into v_employee_name
    from public.employees where id = v_employee_id;
    v_status := 'IN_PROGRESS';
    v_queue_status := 'SERVING';
    v_end := v_start + make_interval(mins => v_duration);
    v_wait := 0;
  else
    select min(bs.end_at) into v_estimated_start
    from public.booking_staff bs
    join public.employees e on e.id = bs.employee_id
    where e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and bs.status = 'ACTIVE' and bs.end_at > now()
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      )
      and not exists (
        select 1 from public.employee_leaves l
        where l.employee_id = e.id and l.status = 'APPROVED' and l.end_at > now()
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id and b.end_at > now()
      )
      and (
        not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_queue_date)
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = v_queue_date
            and sh.is_working and now() between sh.start_at and sh.end_at
        )
      )
      and (
        not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or exists (
          select 1 from public.employee_skills es
          where es.employee_id = e.id and es.service_id = p_service_id
        )
      );
    v_wait := case when v_estimated_start is null then null
      else greatest(0, ceil(extract(epoch from (v_estimated_start - now())) / 60.0)::integer)
    end;
    v_end := coalesce(v_estimated_start, now()) + make_interval(mins => v_duration);
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
    p_salon_id, v_customer_id, v_customer_name, nullif(trim(p_customer_phone), ''),
    'WI-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text, 1, 6),
    'WALK_IN', v_status, coalesce(v_estimated_start, v_start), v_end,
    case when v_status = 'IN_PROGRESS' then v_start end,
    v_service.price_paise, v_service.price_paise, 'PAY_AT_SALON'
  ) returning id into v_booking_id;

  insert into public.booking_items (
    salon_id, booking_id, service_id, service_name_snapshot, unit_price_paise, duration_minutes
  ) values (
    p_salon_id, v_booking_id, v_service.id, v_service.name, v_service.price_paise, v_service.duration_minutes
  );
  insert into public.queue_entries (
    salon_id, booking_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
    queue_date, queue_number, estimated_wait_minutes, estimated_start_at, status, service_started_at
  ) values (
    p_salon_id, v_booking_id, v_customer_id, v_customer_name, nullif(trim(p_customer_phone), ''),
    v_queue_date, v_queue_number, v_wait,
    case when v_wait is null then null else coalesce(v_estimated_start, v_start) end,
    v_queue_status, case when v_status = 'IN_PROGRESS' then v_start end
  );

  if v_employee_id is not null then
    insert into public.booking_staff (salon_id, booking_id, employee_id, start_at, end_at, assignment_type)
    values (
      p_salon_id, v_booking_id, v_employee_id, v_start, v_end,
      case when p_assignment_mode = 'MANUAL' then 'MANUAL' else 'AUTOMATIC' end
    );
  end if;

  insert into public.audit_logs (salon_id, actor_id, action, entity_type, entity_id, new_values)
  values (
    p_salon_id, auth.uid(), 'CREATE_WALKIN', 'BOOKING', v_booking_id,
    jsonb_build_object('customer_name', v_customer_name, 'assignment_mode', p_assignment_mode)
  );
  perform public.refresh_salon_floor_queue(p_salon_id);
  return query select v_booking_id, v_status, v_queue_number, v_employee_name;
end;
$$;

revoke all on function public.create_walkin_booking(uuid, text, text, uuid, uuid, text) from public;
grant execute on function public.create_walkin_booking(uuid, text, text, uuid, uuid, text) to authenticated;

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
        and now() between l.start_at and l.end_at
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id and now() between b.start_at and b.end_at
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
          and sh.is_working and now() between sh.start_at and sh.end_at
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
          and l.end_at > now()
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id and b.end_at > now()
      )
      and (
        not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = v_today
            and sh.is_working and now() between sh.start_at and sh.end_at
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
  end if;
  if v_booking_status = 'CONFIRMED' then
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
  values (p_salon_id, v_booking_id, v_customer_id, v_today, v_queue_number, v_wait,
    case when v_wait is null then null else v_start end);

  if v_booking_status <> 'CONFIRMED' then
    insert into public.notifications (user_id, salon_id, booking_id, title, message, notification_type)
    values (
      v_customer_id, p_salon_id, v_booking_id, 'Appointment in queue',
      case when v_wait is null
        then 'Your appointment is in the queue. The waiting time will be updated when a barber is available.'
        else 'Your appointment is in the queue. Estimated waiting time: ' || v_wait || ' minutes.'
      end,
      'QUEUE_UPDATE'
    );
  end if;

  return query select v_booking_id, v_booking_status, v_wait,
    case when v_wait is null then null else v_start end, v_employee_name;
end;
$$;

revoke all on function public.create_auto_assigned_booking(uuid, uuid[], boolean) from public;
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
        and now() between l.start_at and l.end_at
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id and now() between b.start_at and b.end_at
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
          and sh.is_working and now() between sh.start_at and sh.end_at
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
      where l.employee_id = e.id and l.status = 'APPROVED' and l.end_at > now()
    )
    and not exists (
      select 1 from public.employee_breaks b
      where b.employee_id = e.id and b.end_at > now()
    )
    and (
      not exists (select 1 from public.employee_shifts sh where sh.employee_id = e.id and sh.shift_date = v_today)
      or exists (
        select 1 from public.employee_shifts sh
        where sh.employee_id = e.id and sh.shift_date = v_today
          and sh.is_working and now() between sh.start_at and sh.end_at
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

create or replace function public.refresh_salon_floor_queue(p_salon_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_start timestamptz;
  v_wait integer;
begin
  perform public.assert_floor_admin(p_salon_id);
  for r in
    select qe.id, qe.booking_id
    from public.queue_entries qe
    where qe.salon_id = p_salon_id
      and qe.queue_date = (now() at time zone 'Asia/Kolkata')::date
      and qe.status = 'WAITING'
    order by qe.queue_number
  loop
    select min(greatest(now(), coalesce((
      select min(bs.end_at)
      from public.booking_staff bs
      where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now()
    ), now()))) into v_start
    from public.employees e
    where e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (
        select 1 from public.employee_floor_status fs
        where fs.employee_id = e.id and fs.status in ('BREAK', 'OFFLINE')
      )
      and not exists (
        select 1 from public.employee_leaves l
        where l.employee_id = e.id and l.status = 'APPROVED' and l.end_at > now()
      )
      and not exists (
        select 1 from public.employee_breaks b
        where b.employee_id = e.id and b.end_at > now()
      )
      and (
        not exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = (now() at time zone 'Asia/Kolkata')::date
        )
        or exists (
          select 1 from public.employee_shifts sh
          where sh.employee_id = e.id and sh.shift_date = (now() at time zone 'Asia/Kolkata')::date
            and sh.is_working and now() between sh.start_at and sh.end_at
        )
      )
      and (
        not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or not exists (
          select 1 from public.booking_items bi
          where bi.booking_id = r.booking_id
            and bi.service_id is not null
            and not exists (
              select 1 from public.employee_skills es
              where es.employee_id = e.id and es.service_id = bi.service_id
            )
        )
      );
    v_wait := case when v_start is null then null
      else greatest(0, ceil(extract(epoch from (v_start - now())) / 60.0)::integer)
    end;
    update public.queue_entries
    set estimated_wait_minutes = v_wait,
        estimated_start_at = v_start
    where id = r.id;
  end loop;
end;
$$;
