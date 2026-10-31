-- BOOKSALOON | 014: Cross-platform queue notification devices and events

create table if not exists public.device_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  platform text not null check (platform in ('WEB', 'ANDROID')),
  endpoint text,
  subscription_json jsonb,
  permission_status text not null default 'UNKNOWN',
  user_agent text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists public.queue_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null check (event_type in (
    'BOOKING_CONFIRMED', 'QUEUE_JOINED', 'QUEUE_ETA_UPDATED', 'TURN_APPROACHING',
    'CUSTOMER_NEXT', 'CHAIR_READY', 'BOOKING_CANCELLED', 'SERVICE_STARTED', 'SERVICE_COMPLETED'
  )),
  event_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists queue_notification_events_user_idx
  on public.queue_notification_events(user_id, created_at desc);

alter table public.device_push_subscriptions enable row level security;
alter table public.queue_notification_events enable row level security;

drop policy if exists device_push_subscriptions_own on public.device_push_subscriptions;
create policy device_push_subscriptions_own on public.device_push_subscriptions
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists queue_notification_events_own_select on public.queue_notification_events;
create policy queue_notification_events_own_select on public.queue_notification_events
for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());

create or replace function public.register_device_push_subscription(
  p_device_id text,
  p_platform text,
  p_endpoint text default null,
  p_subscription_json jsonb default null,
  p_permission_status text default 'UNKNOWN',
  p_user_agent text default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_platform not in ('WEB', 'ANDROID') then raise exception 'Invalid platform'; end if;
  insert into public.device_push_subscriptions (
    user_id, device_id, platform, endpoint, subscription_json,
    permission_status, user_agent, last_seen_at, revoked_at
  ) values (
    auth.uid(), trim(p_device_id), p_platform, p_endpoint, p_subscription_json,
    p_permission_status, p_user_agent, now(), null
  )
  on conflict (user_id, device_id) do update set
    platform = excluded.platform,
    endpoint = excluded.endpoint,
    subscription_json = excluded.subscription_json,
    permission_status = excluded.permission_status,
    user_agent = excluded.user_agent,
    last_seen_at = now(),
    revoked_at = null
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.register_device_push_subscription(text,text,text,jsonb,text,text) from public;
grant execute on function public.register_device_push_subscription(text,text,text,jsonb,text,text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_entries') then
    null;
  end if;
exception when undefined_object then
  null;
end $$;
