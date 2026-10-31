-- BOOKSALOON | 007: Safe RPC helpers, salon onboarding and queue numbering
-- These are starting primitives. Implement full booking/assignment in a single
-- transactional RPC before allowing customers to create live bookings.

-- Create a salon and automatically link the caller as OWNER.
create or replace function public.create_salon(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_city text default null,
  p_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Salon name is required'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid salon slug'; end if;

  insert into public.salons (created_by, name, slug, phone, city, state)
  values (auth.uid(), trim(p_name), p_slug, p_phone, p_city, p_state)
  returning id into v_salon_id;

  insert into public.salon_members (salon_id, user_id, role)
  values (v_salon_id, auth.uid(), 'OWNER');

  return v_salon_id;
end;
$$;

revoke all on function public.create_salon(text,text,text,text,text) from public;
grant execute on function public.create_salon(text,text,text,text,text) to authenticated;

-- Generate the next queue number safely for a salon and local queue date.
-- Call within the same transaction that inserts the queue entry.
create or replace function public.next_queue_number(p_salon_id uuid, p_queue_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not public.is_salon_member(p_salon_id) and not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_salon_id::text || ':' || p_queue_date::text, 0)
  );

  select coalesce(max(queue_number), 0) + 1
    into v_next
  from public.queue_entries
  where salon_id = p_salon_id and queue_date = p_queue_date;

  return v_next;
end;
$$;

revoke all on function public.next_queue_number(uuid,date) from public;
grant execute on function public.next_queue_number(uuid,date) to authenticated;

-- Enable Realtime publication for tables whose changes should update clients.
-- Supabase may already have some tables in this publication; duplicate-safe blocks.
do $$
declare t text;
begin
  foreach t in array array['bookings','queue_entries','notifications','chairs','booking_staff','booking_resources'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; enable Realtime publication in Supabase dashboard later.';
end $$;


-- Customers cancel only their own eligible booking through this narrow RPC.
-- This deliberately does not allow customers to update arbitrary booking columns.
create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_status public.booking_status;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select customer_id, status
    into v_customer_id, v_status
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found'; end if;
  if v_customer_id <> auth.uid() then raise exception 'Not authorized'; end if;
  if v_status not in ('PENDING', 'CONFIRMED', 'WAITING', 'BARBER_ASSIGNED') then
    raise exception 'Booking cannot be cancelled in its current state';
  end if;

  update public.bookings
  set status = 'CANCELLED', updated_at = now()
  where id = p_booking_id;

  update public.booking_staff
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';

  update public.booking_resources
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status = 'ACTIVE';

  update public.queue_entries
  set status = 'CANCELLED'
  where booking_id = p_booking_id and status in ('WAITING', 'CALLED');
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant execute on function public.cancel_booking(uuid) to authenticated;
