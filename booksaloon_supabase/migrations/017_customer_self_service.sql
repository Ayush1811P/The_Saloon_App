-- Customer notification cleanup and server-side OTP password resets.

alter table public.bookings alter column customer_id drop not null;
alter table public.queue_entries alter column customer_id drop not null;

create policy notifications_own_delete on public.notifications
for delete to authenticated
using (user_id = auth.uid());

create table public.password_reset_otps (
  phone text primary key check (phone ~ '^\+91[6-9][0-9]{9}$'),
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  consumed_at timestamptz
);

alter table public.password_reset_otps enable row level security;
revoke all on public.password_reset_otps from public, anon, authenticated;
grant all on public.password_reset_otps to service_role;

create or replace function public.consume_password_reset_otp(p_phone text, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  update public.password_reset_otps
  set consumed_at = now(),
      attempt_count = attempt_count + 1
  where phone = p_phone
    and code_hash = p_code_hash
    and expires_at > now()
    and attempt_count < 5
    and consumed_at is null;

  get diagnostics v_rows = row_count;
  if v_rows > 0 then return true; end if;

  update public.password_reset_otps
  set attempt_count = attempt_count + 1
  where phone = p_phone
    and expires_at > now()
    and attempt_count < 5
    and consumed_at is null;
  return false;
end;
$$;

revoke all on function public.consume_password_reset_otp(text, text) from public, anon, authenticated;
grant execute on function public.consume_password_reset_otp(text, text) to service_role;

create or replace function public.create_walkin_booking(
  p_salon_id uuid,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_service_id uuid default null,
  p_preferred_employee_id uuid default null,
  p_assignment_mode text default 'AUTO'
)
returns table (booking_id uuid, booking_status public.booking_status, queue_number integer, assigned_employee_name text)
language plpgsql
security definer
set search_path = ''
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
  if p_assignment_mode not in ('AUTO', 'MANUAL', 'QUEUE') then raise exception 'Invalid assignment mode'; end if;

  select * into v_service from public.services
  where id = p_service_id and salon_id = p_salon_id and is_active;
  if not found then raise exception 'Selected service is unavailable'; end if;

  if nullif(trim(coalesce(p_customer_phone, '')), '') is not null then
    select id into v_customer_id from public.profiles
    where phone = trim(p_customer_phone) limit 1;
  end if;

  if p_assignment_mode = 'MANUAL' then
    v_employee_id := p_preferred_employee_id;
    if v_employee_id is null then raise exception 'Select an available barber'; end if;
  elsif p_assignment_mode = 'AUTO' then
    select e.id into v_employee_id
    from public.employees e
    where e.salon_id = p_salon_id and e.status = 'ACTIVE'
      and not exists (select 1 from public.employee_floor_status fs where fs.employee_id = e.id and fs.status in ('BREAK','OFFLINE'))
      and not exists (select 1 from public.employee_leaves l where l.employee_id = e.id and l.status = 'APPROVED' and now() between l.start_at and l.end_at)
      and (not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
        or exists (select 1 from public.employee_skills es where es.employee_id = e.id and es.service_id = p_service_id))
      and not exists (select 1 from public.booking_staff bs where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now())
    order by e.created_at limit 1;
  end if;

  if v_employee_id is not null then
    if not exists (
      select 1 from public.employees e
      where e.id = v_employee_id and e.salon_id = p_salon_id and e.status = 'ACTIVE'
        and not exists (select 1 from public.employee_floor_status fs where fs.employee_id = e.id and fs.status in ('BREAK','OFFLINE'))
        and (not exists (select 1 from public.employee_skills es where es.employee_id = e.id)
          or exists (select 1 from public.employee_skills es where es.employee_id = e.id and es.service_id = p_service_id))
        and not exists (select 1 from public.booking_staff bs where bs.employee_id = e.id and bs.status = 'ACTIVE' and bs.end_at > now())
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
    p_salon_id, v_customer_id, nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_customer_phone, '')), ''),
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
    p_salon_id, v_booking_id, v_customer_id, nullif(trim(coalesce(p_customer_name, '')), ''), nullif(trim(coalesce(p_customer_phone, '')), ''),
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
    jsonb_build_object('assignment_mode', p_assignment_mode));
  perform public.refresh_salon_floor_queue(p_salon_id);
  return query select v_booking_id, v_status, v_queue_number, v_employee_name;
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
  if new.customer_id is null then return new; end if;

  if tg_op = 'INSERT' and new.status = 'WAITING' then
    perform public.enqueue_queue_notification_event(
      new.booking_id,
      'QUEUE_JOINED',
      'queue-joined:' || new.id::text,
      jsonb_build_object(
        'queueNumber', new.queue_number,
        'estimatedWaitMinutes', new.estimated_wait_minutes,
        'estimatedStartAt', new.estimated_start_at,
        'queueStartedAt', new.created_at
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
          'estimatedStartAt', new.estimated_start_at,
          'queueStartedAt', new.created_at
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
          jsonb_build_object(
            'estimatedWaitMinutes', new.estimated_wait_minutes,
            'estimatedStartAt', new.estimated_start_at,
            'queueStartedAt', new.created_at
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;
