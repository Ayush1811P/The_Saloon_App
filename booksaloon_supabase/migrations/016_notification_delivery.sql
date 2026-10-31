-- BOOKSALOON | 016: Notification delivery leases, attempts, retries, and preferences

alter table public.queue_notification_events
  add column if not exists delivery_status text not null default 'PENDING',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_error text,
  add column if not exists processing_token uuid,
  add column if not exists processing_lease_until timestamptz;

alter table public.queue_notification_events
  drop constraint if exists queue_notification_events_delivery_status_check;
alter table public.queue_notification_events
  add constraint queue_notification_events_delivery_status_check
  check (delivery_status in ('PENDING', 'PROCESSING', 'DELIVERED', 'PARTIAL', 'FAILED'));

alter table public.queue_notification_events
  drop constraint if exists queue_notification_events_event_type_check;
alter table public.queue_notification_events
  add constraint queue_notification_events_event_type_check
  check (event_type in (
    'BOOKING_CONFIRMED', 'QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TURN_APPROACHING',
    'CUSTOMER_NEXT', 'CHAIR_READY', 'BOOKING_CANCELLED', 'SERVICE_STARTED', 'SERVICE_COMPLETED'
  ));

create index if not exists queue_notification_events_claim_idx
  on public.queue_notification_events (next_attempt_at, created_at)
  where delivery_status in ('PENDING', 'PROCESSING');

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  booking_updates boolean not null default true,
  queue_updates boolean not null default true,
  offers boolean not null default true,
  announcements boolean not null default true,
  browser_enabled boolean not null default true,
  android_enabled boolean not null default true,
  queue_enabled boolean not null default true,
  turn_alerts_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.queue_notification_events(id) on delete cascade,
  device_id uuid not null references public.device_push_subscriptions(id) on delete cascade,
  status text not null,
  response_code integer,
  error_message text,
  attempted_at timestamptz not null default now()
);

alter table public.notification_preferences
  add column if not exists browser_enabled boolean not null default true,
  add column if not exists android_enabled boolean not null default true,
  add column if not exists queue_enabled boolean not null default true,
  add column if not exists turn_alerts_enabled boolean not null default true;

alter table public.notification_preferences enable row level security;
drop policy if exists notification_preferences_own_select_update on public.notification_preferences;
create policy notification_preferences_own_select_update on public.notification_preferences
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.notification_delivery_attempts
  add column if not exists attempt_number integer not null default 1,
  add column if not exists platform text,
  add column if not exists permanent_failure boolean not null default false;

alter table public.notification_delivery_attempts
  drop constraint if exists notification_delivery_attempts_status_check;
alter table public.notification_delivery_attempts
  add constraint notification_delivery_attempts_status_check
  check (status in ('SENT', 'FAILED', 'REVOKED'));

alter table public.notification_delivery_attempts
  drop constraint if exists notification_delivery_attempts_event_id_device_id_key;

create index if not exists notification_delivery_attempts_lookup_idx
  on public.notification_delivery_attempts (event_id, device_id, status);
create unique index if not exists notification_delivery_attempts_event_device_attempt_idx
  on public.notification_delivery_attempts (event_id, device_id, attempt_number);

alter table public.notification_delivery_attempts enable row level security;
drop policy if exists notification_delivery_attempts_own_select on public.notification_delivery_attempts;
create policy notification_delivery_attempts_own_select on public.notification_delivery_attempts
for select to authenticated using (exists (
  select 1 from public.queue_notification_events e
  where e.id = event_id and (e.user_id = auth.uid() or public.is_platform_admin())
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
      and (
        (e.delivery_status in ('PENDING', 'FAILED', 'PARTIAL') and e.next_attempt_at <= now())
        or (e.delivery_status = 'PROCESSING' and coalesce(e.processing_lease_until, 'epoch'::timestamptz) < now())
      )
    order by e.created_at
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
