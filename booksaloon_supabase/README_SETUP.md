# BOOKSALOON Supabase database setup

## Architecture
- Multi-tenant SaaS: one Supabase project, many salons.
- `salon_id` scopes tenant-owned data.
- `profiles.id` references `auth.users.id`.
- Supabase Auth stores passwords; never create a password column.
- No OTP and no payment gateway are implemented by these migrations.
- Money is stored as integer paise.

## Apply migrations
Run the SQL files in `migrations/` in numeric order using the Supabase SQL Editor,
or copy them into a Supabase CLI project's `supabase/migrations/` directory and
apply with the Supabase CLI.

Recommended order:
1. 001_foundation_and_tenants.sql
2. 002_salon_operations.sql
3. 003_offers_and_bookings.sql
4. 004_queue_notifications_and_customer_features.sql
5. 005_settings_audit_and_integrity.sql
6. 006_rls_policies.sql
7. 007_rpc_helpers_and_realtime.sql
8. 008_seed_demo_data.sql (optional; comments only)
9. 009_tenant_integrity_hardening.sql
10. 010_admin_sessions.sql
11. 011_queue_arrival_policy.sql

## Admin foundation
Migration 010 adds a server-side `admin_sessions` table and security-definer RPCs
for issuing, validating, and revoking admin dashboard sessions. The issue RPC
atomically revokes the oldest active session when a fourth device logs in.

Admin users must first be created through Supabase Auth and then authorized by
inserting their user ID into `platform_admins` using a trusted process. The
admin session RPC intentionally does not grant dashboard access to ordinary
salon members.
The frontend never contains an admin credential list or password.

## Phone-number registration with password authentication (no OTP)
In Supabase Dashboard:
1. Authentication -> Providers -> Email: enable the provider and ensure
   "Allow new users to sign up" is enabled.
2. Disable email confirmation so registration completes without an OTP or email
   verification step.
3. Keep the Phone provider and phone confirmations disabled. The frontend
   validates the Indian phone number and uses a private email alias internally
   for password authentication.
4. Configure password policy and rate limits.
5. Test sign-up and sign-in before building the UI.

The phone number remains the user's login identifier in the UI, while the
internal alias allows password registration without requiring an SMS provider
or OTP service.

Important: Supabase phone authentication settings can change. Confirm the current
Dashboard options for your project. If the provider requires confirmation, do not
silently add OTP; choose an authentication design deliberately.

## Environment variables
Frontend:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY (or the project's publishable key)

Never put the service_role key in a Vite/React frontend. Any privileged operation
must run in a trusted server/Edge Function context.

## Important security and implementation notes
- The RLS policies are a starting baseline, not a complete production security audit.
- Do not allow the browser to directly create employee/chair assignment rows.
- Implement booking creation, assignment, queue insertion and notification creation
  in one trusted transactional RPC or server-side function.
- The exclusion constraints on `booking_staff` and `booking_resources` prevent
  overlapping active assignments to the same employee/chair.
- Migration 009 prevents authenticated salon members from changing a booking's
  customer or salon, and validates same-salon employee schedules, queue customers,
  coupon offers and review references.
- Migration 009 does not implement transactional booking creation or automatic
  assignment. Customers must not be told that Quick Turn is production-ready.
- The current RLS intentionally prevents customers from creating assignment rows.
- Owner onboarding should call `create_salon(...)`, not insert directly into `salons`
  and `salon_members` separately.
- Promote platform admins manually through a trusted SQL/admin process; never expose
  a public RPC that lets a user promote themselves.
- Review all policies before production. In particular, decide whether anonymous
  users should see active salon profiles, chairs, employee names and reviews.
- Consider adding Supabase Storage buckets and storage policies for salon logos,
  employee photos and service images.
- Consider adding a transactional booking RPC that validates service/employee/shift,
  acquires locks, creates booking + items + assignments + queue entry, and returns ETA.
- Analytics should initially use SQL views over bookings and booking_items. Add
  materialized views only when data volume justifies them.

## Known design choices
- `booking_staff` and `booking_resources` store the actual reserved time range.
- `bookings.scheduled_start` / `scheduled_end` store the overall appointment window.
- Queue dates should be calculated in the salon's timezone by trusted server logic.
- `chair.status` is an operational display field. Actual time conflicts are governed
  by active `booking_resources` rows and exclusion constraints.
- `payment_status` is tracking only. No gateway or card data is stored.
