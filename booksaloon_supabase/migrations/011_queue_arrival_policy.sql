-- BOOKSALOON | 011: Queue arrival and no-show policy

create or replace function public.expire_overdue_queue_entries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  with overdue as (
    select qe.id, qe.booking_id, qe.customer_id, qe.salon_id
    from public.queue_entries qe
    where qe.status = 'CALLED'
      and qe.called_at <= now() - interval '10 minutes'
      and (
        public.is_platform_admin()
        or public.is_salon_member(qe.salon_id)
        or qe.customer_id = auth.uid()
      )
    for update
  ),
  marked_queue as (
    update public.queue_entries qe
    set status = 'SKIPPED',
        completed_at = now()
    from overdue o
    where qe.id = o.id
    returning o.booking_id, o.customer_id, o.salon_id
  ),
  marked_bookings as (
    update public.bookings b
    set status = 'NO_SHOW',
        updated_at = now()
    from marked_queue mq
    where b.id = mq.booking_id
      and b.status in ('WAITING', 'BARBER_ASSIGNED', 'IN_PROGRESS', 'CONFIRMED')
    returning mq.customer_id, mq.salon_id, b.id
  )
  insert into public.notifications (
    user_id, salon_id, booking_id, title, message, notification_type
  )
  select customer_id, salon_id, id,
         'Appointment missed',
         'Your turn was held for 10 minutes. The appointment was released because you did not arrive.',
         'GENERAL'
  from marked_bookings;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select salon_id into v_salon_id
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  update public.bookings
  set status = 'CANCELLED', updated_at = now()
  where id = p_booking_id;

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

revoke all on function public.expire_overdue_queue_entries() from public, anon;
revoke all on function public.admin_cancel_booking(uuid) from public, anon;
grant execute on function public.expire_overdue_queue_entries() to authenticated;
grant execute on function public.admin_cancel_booking(uuid) to authenticated;
