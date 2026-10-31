-- BOOKSALOON | 015: Transactional queue notification event generation

create or replace function public.enqueue_queue_notification_event(
  p_booking_id uuid,
  p_event_type text,
  p_event_key text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_customer_id uuid;
  v_salon_id uuid;
begin
  if p_event_type not in (
    'BOOKING_CONFIRMED', 'QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TURN_APPROACHING',
    'CUSTOMER_NEXT', 'CHAIR_READY', 'BOOKING_CANCELLED', 'SERVICE_STARTED', 'SERVICE_COMPLETED'
  ) then
    raise exception 'Invalid queue notification event type';
  end if;
  if nullif(trim(p_event_key), '') is null then
    raise exception 'Queue notification event key is required';
  end if;

  select b.customer_id, b.salon_id
    into v_customer_id, v_salon_id
  from public.bookings b
  where b.id = p_booking_id;
  if v_customer_id is null or v_salon_id is null then
    return null;
  end if;

  insert into public.queue_notification_events (
    user_id, salon_id, booking_id, event_type, event_key, payload
  )
  values (
    v_customer_id, v_salon_id, p_booking_id, p_event_type, p_event_key,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.queue_booking_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_service text;
begin
  if new.customer_id is null then
    return new;
  end if;

  select coalesce(nullif(new.customer_name_snapshot, ''), p.full_name, 'Customer')
    into v_name
  from public.profiles p
  where p.id = new.customer_id;
  select string_agg(bi.service_name_snapshot, ', ' order by bi.created_at)
    into v_service
  from public.booking_items bi
  where bi.booking_id = new.id;

  if tg_op = 'INSERT' and new.booking_type in ('NORMAL', 'QUICK_TURN')
     and new.status = 'CONFIRMED' then
    perform public.enqueue_queue_notification_event(
      new.id,
      'BOOKING_CONFIRMED',
      'booking-confirmed:' || new.id::text,
      jsonb_build_object(
        'customerName', v_name,
        'service', coalesce(v_service, 'Salon service')
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      if new.status = 'CONFIRMED' then
        perform public.enqueue_queue_notification_event(
          new.id,
          'BOOKING_CONFIRMED',
          'booking-confirmed:' || new.id::text,
          jsonb_build_object(
            'customerName', v_name,
            'service', coalesce(v_service, 'Salon service')
          )
        );
      elsif new.status = 'CANCELLED' then
        perform public.enqueue_queue_notification_event(
          new.id,
          'BOOKING_CANCELLED',
          'booking-cancelled:' || new.id::text,
          jsonb_build_object('customerName', v_name)
        );
      elsif new.status = 'IN_PROGRESS' then
        perform public.enqueue_queue_notification_event(
          new.id,
          'SERVICE_STARTED',
          'service-started:' || new.id::text,
          jsonb_build_object(
            'customerName', v_name,
            'service', coalesce(v_service, 'Salon service')
          )
        );
      elsif new.status = 'COMPLETED' then
        perform public.enqueue_queue_notification_event(
          new.id,
          'SERVICE_COMPLETED',
          'service-completed:' || new.id::text,
          jsonb_build_object(
            'customerName', v_name,
            'service', coalesce(v_service, 'Salon service')
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.queue_entry_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce(nullif(new.customer_name_snapshot, ''), 'Customer');
begin
  if new.customer_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'WAITING' then
    perform public.enqueue_queue_notification_event(
      new.booking_id,
      'QUEUE_JOINED',
      'queue-joined:' || new.id::text,
      jsonb_build_object(
        'queueNumber', new.queue_number,
        'estimatedWaitMinutes', new.estimated_wait_minutes,
        'estimatedStartAt', new.estimated_start_at
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      if new.status = 'CALLED' then
        perform public.enqueue_queue_notification_event(
          new.booking_id,
          'CUSTOMER_NEXT',
          'customer-next:' || new.id::text || ':' || new.status::text,
          jsonb_build_object('queueNumber', new.queue_number, 'customerName', v_name)
        );
      elsif new.status = 'SERVING' then
        perform public.enqueue_queue_notification_event(
          new.booking_id,
          'CHAIR_READY',
          'chair-ready:' || new.id::text || ':' || new.status::text,
          jsonb_build_object('queueNumber', new.queue_number)
        );
      end if;
    end if;

    if old.estimated_wait_minutes is distinct from new.estimated_wait_minutes
       or old.estimated_start_at is distinct from new.estimated_start_at then
      perform public.enqueue_queue_notification_event(
        new.booking_id,
        'QUEUE_ETA_UPDATED',
        'queue-eta:' || new.id::text || ':' ||
          coalesce(new.estimated_wait_minutes::text, 'null') || ':' ||
          coalesce(new.estimated_start_at::text, 'null'),
        jsonb_build_object(
          'queueNumber', new.queue_number,
          'estimatedWaitMinutes', new.estimated_wait_minutes,
          'estimatedStartAt', new.estimated_start_at
        )
      );
      if new.estimated_wait_minutes is not null
         and new.estimated_wait_minutes between 1 and 10 then
        perform public.enqueue_queue_notification_event(
          new.booking_id,
          'TURN_APPROACHING',
          'turn-approaching:' || new.id::text || ':' ||
            coalesce(new.estimated_wait_minutes::text, 'null') || ':' ||
            coalesce(new.estimated_start_at::text, 'null'),
          jsonb_build_object('estimatedWaitMinutes', new.estimated_wait_minutes)
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists queue_booking_notification_events on public.bookings;
create trigger queue_booking_notification_events
after insert or update of status, updated_at on public.bookings
for each row execute function public.queue_booking_event_trigger();

drop trigger if exists queue_entry_notification_events on public.queue_entries;
create trigger queue_entry_notification_events
after insert or update of status, estimated_wait_minutes, estimated_start_at
on public.queue_entries
for each row execute function public.queue_entry_event_trigger();

create or replace function public.staff_availability_event_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      perform public.refresh_salon_floor_queue(new.salon_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_availability_notification_events on public.employee_floor_status;
create trigger staff_availability_notification_events
after insert or update of status on public.employee_floor_status
for each row execute function public.staff_availability_event_trigger();

revoke all on function public.enqueue_queue_notification_event(uuid,text,text,jsonb) from public;
revoke all on function public.queue_booking_event_trigger() from public;
revoke all on function public.queue_entry_event_trigger() from public;
revoke all on function public.staff_availability_event_trigger() from public;
