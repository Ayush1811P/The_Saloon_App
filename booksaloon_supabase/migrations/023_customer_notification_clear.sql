-- BOOKSALOON | 023: Keep customer notification clearing available through RPC and RLS

drop policy if exists notifications_customer_delete_own on public.notifications;
create policy notifications_customer_delete_own on public.notifications
for delete to authenticated
using (user_id = auth.uid());

create or replace function public.clear_customer_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.notifications where user_id = auth.uid();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.clear_customer_notifications() is
  'Permanently deletes all notification rows belonging to the authenticated customer.';

revoke all on function public.clear_customer_notifications() from public, anon;
grant execute on function public.clear_customer_notifications() to authenticated;

notify pgrst, 'reload schema';
