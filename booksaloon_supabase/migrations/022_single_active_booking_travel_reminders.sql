-- BOOKSALOON | 022: One active appointment per customer and scheduled journey push

do $$
begin
  if exists (
    select 1
    from public.bookings
    where status in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS')
    group by customer_id
    having count(*) > 1
  ) then
    raise exception 'Resolve existing customers with multiple active bookings before applying migration 022.';
  end if;
end;
$$;

create or replace function public.prevent_multiple_active_customer_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('booking-customer:' || new.customer_id::text, 0)
    );

    if exists (
      select 1
      from public.bookings b
      where b.customer_id = new.customer_id
        and b.id is distinct from new.id
        and b.status in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS')
    ) then
      raise exception 'ACTIVE_BOOKING_EXISTS'
        using errcode = '23505',
          detail = 'A customer must complete the current appointment or have it cancelled by the salon owner before booking again.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_one_active_per_customer on public.bookings;
create trigger bookings_one_active_per_customer
before insert or update of customer_id, status on public.bookings
for each row execute function public.prevent_multiple_active_customer_bookings();

create unique index if not exists bookings_one_active_per_customer_idx
  on public.bookings(customer_id)
  where status in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS');

-- Customer cancellation is intentionally not available through the public RPC.
revoke all on function public.cancel_booking(uuid) from public, anon, authenticated;

create or replace function public.admin_cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
begin
  select salon_id into v_salon_id
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if auth.uid() is null or not (
    public.is_platform_admin()
    or public.has_salon_role(v_salon_id, array['OWNER']::public.member_role[])
  ) then
    raise exception 'Salon owner access required' using errcode = '42501';
  end if;

  update public.bookings
  set status = 'CANCELLED', updated_at = now()
  where id = p_booking_id
    and status not in ('CANCELLED', 'COMPLETED', 'NO_SHOW');

  update public.queue_entries
  set status = 'CANCELLED'
  where booking_id = p_booking_id
    and status in ('WAITING', 'CALLED');

  update public.booking_staff
  set status = 'CANCELLED'
  where booking_id = p_booking_id
    and status = 'ACTIVE';

  update public.booking_resources
  set status = 'CANCELLED'
  where booking_id = p_booking_id
    and status = 'ACTIVE';
end;
$$;

revoke all on function public.admin_cancel_booking(uuid) from public, anon;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;

alter table public.queue_notification_events
  add column if not exists not_before timestamptz not null default now();

alter table public.queue_notification_events
  drop constraint if exists queue_notification_events_event_type_check;
alter table public.queue_notification_events
  add constraint queue_notification_events_event_type_check
  check (event_type in (
    'BOOKING_CONFIRMED', 'QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TURN_APPROACHING',
    'CUSTOMER_NEXT', 'CHAIR_READY', 'BOOKING_CANCELLED', 'SERVICE_STARTED',
    'SERVICE_COMPLETED', 'TRAVEL_REMINDER'
  ));

create or replace function public.claim_queue_notification_events(
  p_limit integer default 50,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  user_id uuid,
  booking_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer,
  processing_token uuid,
  processing_lease_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'Invalid claim parameters';
  end if;

  return query
  with candidates as (
    select e.id
    from public.queue_notification_events e
    where e.attempt_count < 5
      and e.not_before <= now()
      and (
        (e.delivery_status in ('PENDING', 'FAILED', 'PARTIAL') and e.next_attempt_at <= now())
        or (e.delivery_status = 'PROCESSING' and coalesce(e.processing_lease_until, 'epoch'::timestamptz) < now())
      )
    order by e.not_before, e.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.queue_notification_events e
    set delivery_status = 'PROCESSING',
        attempt_count = e.attempt_count + 1,
        last_attempt_at = now(),
        processing_token = gen_random_uuid(),
        processing_lease_until = now() + make_interval(secs => p_lease_seconds)
    from candidates c
    where e.id = c.id
    returning e.id, e.user_id, e.booking_id, e.event_type, e.payload,
      e.attempt_count, e.processing_token, e.processing_lease_until
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_queue_notification_events(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_queue_notification_events(integer, integer) to service_role;

create or replace function public.schedule_travel_reminder(
  p_booking_id uuid,
  p_travel_minutes integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_salon_id uuid;
  v_salon_name text;
  v_expected_start_at timestamptz;
  v_remind_at timestamptz;
  v_event_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_travel_minutes is null or p_travel_minutes < 0 or p_travel_minutes > 360 then
    raise exception 'Travel estimate must be between 0 and 360 minutes';
  end if;

  select b.salon_id, s.name, q.estimated_start_at
    into v_salon_id, v_salon_name, v_expected_start_at
  from public.bookings b
  join public.salons s on s.id = b.salon_id
  join public.queue_entries q on q.booking_id = b.id
  where b.id = p_booking_id
    and b.customer_id = v_user_id
    and b.status in ('CONFIRMED', 'WAITING', 'BARBER_ASSIGNED')
    and q.status in ('WAITING', 'CALLED')
  order by q.created_at desc
  limit 1;

  if not found then raise exception 'An active queue booking is required'; end if;
  if v_expected_start_at is null then raise exception 'Queue arrival time is not available'; end if;

  v_remind_at := greatest(
    now(),
    v_expected_start_at - make_interval(mins => p_travel_minutes + 3)
  );

  insert into public.queue_notification_events (
    user_id, salon_id, booking_id, event_type, event_key, payload,
    delivery_status, next_attempt_at, not_before
  )
  values (
    v_user_id,
    v_salon_id,
    p_booking_id,
    'TRAVEL_REMINDER',
    'travel-reminder:' || p_booking_id::text,
    jsonb_build_object(
      'salonName', v_salon_name,
      'travelMinutes', p_travel_minutes,
      'preparationBufferMinutes', 3,
      'expectedStartAt', v_expected_start_at
    ),
    'PENDING',
    v_remind_at,
    v_remind_at
  )
  on conflict (event_key) do update
  set payload = excluded.payload,
      delivery_status = 'PENDING',
      attempt_count = 0,
      next_attempt_at = excluded.not_before,
      not_before = excluded.not_before,
      last_error = null,
      processing_token = null,
      processing_lease_until = null
  where public.queue_notification_events.delivery_status in ('PENDING', 'FAILED', 'PARTIAL')
  returning id into v_event_id;

  if v_event_id is null then return null; end if;
  return v_remind_at;
end;
$$;

revoke all on function public.schedule_travel_reminder(uuid, integer) from public, anon;
grant execute on function public.schedule_travel_reminder(uuid, integer) to authenticated;

create or replace function public.clear_pending_travel_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('CANCELLED', 'COMPLETED', 'NO_SHOW') then
    update public.queue_notification_events
    set delivery_status = 'FAILED',
        attempt_count = 5,
        last_error = 'Booking is no longer active'
    where booking_id = new.id
      and event_type = 'TRAVEL_REMINDER'
      and delivery_status in ('PENDING', 'FAILED', 'PARTIAL');
  end if;
  return new;
end;
$$;

drop trigger if exists booking_clear_travel_reminders on public.bookings;
create trigger booking_clear_travel_reminders
after update of status on public.bookings
for each row execute function public.clear_pending_travel_reminders();

revoke all on function public.clear_pending_travel_reminders() from public, anon, authenticated;
