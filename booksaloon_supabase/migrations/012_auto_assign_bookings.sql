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
