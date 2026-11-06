-- Allow salon administrators to permanently clear a salon's appointment history.
create or replace function public.clear_admin_salon_appointments(p_salon_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_salon_id is null
    or (
      not public.is_platform_admin()
      and not public.has_salon_role(p_salon_id, array['OWNER', 'ADMIN']::public.member_role[])
    ) then
    raise exception 'Not authorized to clear appointments for this salon';
  end if;

  delete from public.bookings where salon_id = p_salon_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.clear_admin_salon_appointments(uuid) from public, anon;
grant execute on function public.clear_admin_salon_appointments(uuid) to authenticated;
