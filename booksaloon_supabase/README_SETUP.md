# BOOKSALOON Supabase database setup

## Architecture
- Multi-tenant SaaS: one Supabase project, many salons.
- `salon_id` scopes tenant-owned data.
- `profiles.id` references `auth.users.id`.
- Supabase Auth stores passwords; never create a password column.
- SMS OTP delivery and payment processing are not configured. Migration 017
  supports a temporary, screen-displayed demo OTP for password resets.
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
12. 012_auto_assign_bookings.sql
13. 013_live_salon_floor.sql
14. 014_queue_notifications.sql
15. 015_queue_event_generation.sql
16. 016_notification_delivery.sql
17. 017_customer_self_service.sql
18. 018_booking_availability_and_admin_notifications.sql

For an existing project that already has migration 017, apply migration 018.
Do not rerun `BOOKSALOON_ALL_MIGRATIONS.sql`.

Deploy the password reset Edge Function after applying migration 017:

```text
supabase functions deploy reset-password-by-phone
```

The function changes passwords through the Supabase Auth Admin API and stores
only a hashed, expiring OTP. The temporary OTP is returned to the page for
testing; configure a real SMS provider and stop returning the code before
production use. The migration also enables customer notification deletion and
anonymous, service-only walk-in queue entries.

Migration 018 grants salon admins access to read, mark read and clear their
salon's notifications. It checks staff floor status, shifts, breaks, leave,
service skills and overlapping assignments before confirming a booking. When
no eligible barber is available, the booking remains in the waiting queue.

Migration 016 exposes the privileged
`claim_queue_notification_events(integer, integer)` RPC only to the
service-role context. It claims rows with `FOR UPDATE SKIP LOCKED`, creates a
processing lease, increments the attempt count, and can reclaim expired
processing leases. Browser clients cannot claim or deliver events.

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
- The notification dispatcher must be invoked as a protected POST request with
  `Authorization: Bearer <DISPATCHER_SECRET>`. It uses the claim RPC and must
  not be called from browser code.
Set `DISPATCHER_ALLOWED_ORIGIN` to the trusted frontend origin when browser
preflight support is needed; the dispatcher does not permit arbitrary origins.

## Notification dispatcher verification

These checks require migrations 015 and 016 to be applied in a non-production
Supabase environment and valid delivery credentials. They are executable
verification scenarios, not simulated delivery claims:

1. Start two dispatcher invocations at the same time and verify the same event
   is returned by only one claim call.
2. Register two devices for one customer and verify both receive independent
   rows in `notification_delivery_attempts`.
3. Make one device fail and one succeed; verify the event is `PARTIAL` and the
   successful device is not retried.
4. Return a temporary provider error; verify the event becomes `FAILED` with
   a bounded exponential `next_attempt_at`.
5. Invoke again after success; verify no new attempt is written for the
   already successful device.
6. Return Web Push HTTP 404 or 410; verify the subscription is revoked and
   no retry is scheduled for it.
7. Return an FCM `UNREGISTERED` response; verify the Android device is revoked
   and is not retried.
8. Disable `browser_enabled`, `android_enabled`, `queue_enabled`, or
   `turn_alerts_enabled`; verify the matching platform/category receives no
   request.
9. Remove all eligible devices; verify the event is marked `FAILED` with a
   no-active-device error and is not retried indefinitely.
10. Leave an event in `PROCESSING` past its lease, invoke the dispatcher, and
    verify the claim RPC safely reclaims it.

### SQL trigger verification

Run these checks in a disposable Supabase environment after migrations 015 and
016. Use existing test users, salons, bookings, services, and employees; do
not run them against production data.

1. Insert a confirmed booking and verify exactly one
   `BOOKING_CONFIRMED` event. Insert a waiting booking and verify that it does
   not create a confirmation event.
2. Insert a `WAITING` queue entry and verify one `QUEUE_JOINED` event. Update
   its status and ETA in the same statement and verify one state-transition
   event plus one `QUEUE_ETA_UPDATED` event.
3. Update a booking to `CANCELLED` and its queue entry to `CANCELLED`; verify
   exactly one `BOOKING_CANCELLED` event, generated by the booking trigger.
4. Insert an `employee_floor_status` row and verify it succeeds without
   referencing `OLD`. Update the row from `BREAK` to `AVAILABLE` and verify
   queue estimates are recalculated through `refresh_salon_floor_queue`; ETA
   events are created only where persisted estimates actually changed.
5. Update a queue entry through `CALLED` and `SERVING`, then update the
   booking through `IN_PROGRESS` and `COMPLETED`; verify distinct
   `CUSTOMER_NEXT`, `CHAIR_READY`, `SERVICE_STARTED`, and `SERVICE_COMPLETED`
   events with deterministic keys.
6. Repeat the same updates and verify the event count does not increase.
7. Leave multiple waiting entries in the affected salon and change an
   employee availability state; verify every entry whose estimate changed gets
   its own `QUEUE_ETA_UPDATED` event.
8. Delete or omit the customer's `notification_preferences` row and verify
   the dispatcher sends nothing and records a non-retryable no-preferences
   outcome. Inject query, attempt-insert, revocation, and final-update
   failures in a test harness and verify the dispatcher returns `503` rather
   than reporting success.

Run the frontend checks from the repository root:

```text
npm run build
npm run lint
npx cap sync android
```

An Android Gradle build additionally requires a configured Android SDK and
`android/app/google-services.json`. Real Web Push and FCM delivery require
external VAPID and Firebase credentials and must be tested separately.
- Analytics should initially use SQL views over bookings and booking_items. Add
  materialized views only when data volume justifies them.

## Known design choices
- `booking_staff` and `booking_resources` store the actual reserved time range.
- `bookings.scheduled_start` / `scheduled_end` store the overall appointment window.
- Queue dates should be calculated in the salon's timezone by trusted server logic.
- `chair.status` is an operational display field. Actual time conflicts are governed
  by active `booking_resources` rows and exclusion constraints.
- `payment_status` is tracking only. No gateway or card data is stored.
