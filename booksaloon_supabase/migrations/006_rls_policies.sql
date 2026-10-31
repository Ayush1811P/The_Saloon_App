-- BOOKSALOON | 006: Row Level Security
-- All tenant-owned rows are scoped through salon_members.
-- Never expose the Supabase service-role key in a browser.

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_salon_member(p_salon_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
  );
$$;

create or replace function public.has_salon_role(p_salon_id uuid, p_roles public.member_role[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.user_id = auth.uid()
      and sm.is_active = true
      and sm.role = any(p_roles)
  );
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_salon_member(uuid) to authenticated;
grant execute on function public.has_salon_role(uuid, public.member_role[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.salons enable row level security;
alter table public.salon_members enable row level security;
alter table public.salon_hours enable row level security;
alter table public.employees enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_shifts enable row level security;
alter table public.employee_breaks enable row level security;
alter table public.employee_leaves enable row level security;
alter table public.chairs enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.booking_staff enable row level security;
alter table public.booking_resources enable row level security;
alter table public.queue_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.customer_favorites enable row level security;
alter table public.reviews enable row level security;
alter table public.salon_settings enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: users can read/update their own profile. Platform admins can read all.
create policy profiles_select_own_or_platform on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_platform_admin());
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Platform admin membership is deliberately not self-service.
create policy platform_admins_select_self on public.platform_admins
for select to authenticated using (user_id = auth.uid());

-- Public salon discovery exposes only active salons.
create policy salons_public_active_select on public.salons
for select to anon, authenticated
using (status = 'ACTIVE');
create policy salons_member_select on public.salons
for select to authenticated
using (public.is_salon_member(id) or public.is_platform_admin());
create policy salons_insert_authenticated on public.salons
for insert to authenticated
with check (created_by = auth.uid());
create policy salons_update_owner_admin on public.salons
for update to authenticated
using (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy salon_members_select on public.salon_members
for select to authenticated
using (user_id = auth.uid() or public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_insert_owner on public.salon_members
for insert to authenticated
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_update_owner on public.salon_members
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
create policy salon_members_delete_owner on public.salon_members
for delete to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());

-- Salon catalogue: publicly readable only for active salons and active catalogue entries.
create policy salon_hours_public_select on public.salon_hours
for select to anon, authenticated
using (exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy salon_hours_manage on public.salon_hours
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy categories_public_select on public.service_categories
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy categories_manage on public.service_categories
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy services_public_select on public.services
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy services_manage on public.services
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy offers_public_select on public.offers
for select to anon, authenticated
using (status = 'ACTIVE' and starts_at <= now() and ends_at > now()
  and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy offers_manage on public.offers
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy coupons_public_validate_select on public.coupons
for select to authenticated
using (is_active and public.is_salon_member(salon_id));
create policy coupons_manage on public.coupons
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Employee personal records are not public. Salon members can see employees; owners/admins manage them.
create policy employees_member_select on public.employees
for select to authenticated
using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employees_manage on public.employees
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_skills_member_select on public.employee_skills
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_skills_manage on public.employee_skills
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_shifts_member_select on public.employee_shifts
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_shifts_manage on public.employee_shifts
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_breaks_member_select on public.employee_breaks
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_breaks_manage on public.employee_breaks
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy employee_leaves_member_select on public.employee_leaves
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy employee_leaves_manage on public.employee_leaves
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy chairs_public_select on public.chairs
for select to anon, authenticated
using (is_active and exists (select 1 from public.salons s where s.id = salon_id and s.status = 'ACTIVE'));
create policy chairs_manage on public.chairs
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

-- Booking visibility: customer sees own; salon members see their salon's bookings.
create policy bookings_select_customer_or_member on public.bookings
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy bookings_insert_customer on public.bookings
for insert to authenticated
with check (customer_id = auth.uid() and status = 'PENDING');
create policy bookings_manage_salon on public.bookings
for update to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());
-- Customers cannot directly update booking rows. Use the cancel_booking RPC
-- so they cannot alter prices, assignments, salon_id or timestamps while cancelling.

create policy booking_items_select_related on public.booking_items
for select to authenticated
using (exists (select 1 from public.bookings b where b.id = booking_id
  and (b.customer_id = auth.uid() or public.is_salon_member(b.salon_id) or public.is_platform_admin())));
create policy booking_items_insert_own_pending on public.booking_items
for insert to authenticated
with check (exists (select 1 from public.bookings b where b.id = booking_id
  and b.customer_id = auth.uid() and b.status = 'PENDING' and b.salon_id = salon_id));
create policy booking_items_manage_salon on public.booking_items
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_staff_member_select on public.booking_staff
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_staff_manage on public.booking_staff
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy booking_resources_member_select on public.booking_resources
for select to authenticated
using (public.is_salon_member(salon_id) or exists (
  select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()
) or public.is_platform_admin());
create policy booking_resources_manage on public.booking_resources
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy queue_customer_or_member_select on public.queue_entries
for select to authenticated
using (customer_id = auth.uid() or public.is_salon_member(salon_id) or public.is_platform_admin());
create policy queue_manage_salon on public.queue_entries
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN','STAFF']::public.member_role[]) or public.is_platform_admin());

create policy notifications_own_select on public.notifications
for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
create policy notifications_own_update on public.notifications
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Notification creation should be performed by trusted server/RPC, not arbitrary customers.

create policy notification_preferences_own on public.notification_preferences
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy favorites_own on public.customer_favorites
for all to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy reviews_public_select on public.reviews
for select to anon, authenticated using (true);
create policy reviews_customer_insert on public.reviews
for insert to authenticated
with check (customer_id = auth.uid() and exists (
  select 1 from public.bookings b
  where b.id = booking_id and b.customer_id = auth.uid()
    and b.salon_id = salon_id and b.status = 'COMPLETED'
));
create policy reviews_customer_update on public.reviews
for update to authenticated using (customer_id = auth.uid()) with check (customer_id = auth.uid());

create policy salon_settings_member_select on public.salon_settings
for select to authenticated using (public.is_salon_member(salon_id) or public.is_platform_admin());
create policy salon_settings_manage on public.salon_settings
for all to authenticated
using (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin())
with check (public.has_salon_role(salon_id, array['OWNER','ADMIN']::public.member_role[]) or public.is_platform_admin());

create policy audit_logs_owner_select on public.audit_logs
for select to authenticated
using (public.has_salon_role(salon_id, array['OWNER']::public.member_role[]) or public.is_platform_admin());
-- Audit log inserts should be made by trusted server-side functions.
