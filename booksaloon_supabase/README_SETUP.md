# Supabase setup and operations

This guide covers the Supabase backend used by The Saloon: PostgreSQL,
authentication, row-level security (RLS), realtime, RPCs, and Edge Functions.
The browser app uses the publishable/anon key; privileged operations belong in
trusted database functions or Edge Functions.

## 1. Backend architecture

- One Supabase project can host multiple salons. Tenant-owned rows are scoped by
  `salon_id`.
- Supabase Auth owns passwords and sessions. Do not create a plaintext password
  column in application tables.
- `profiles.id` is tied to the Auth user.
- SQL migrations establish salons, staff, services, appointments, booking
  assignments, queue entries, notifications, preferences, admin sessions, and
  integrity constraints.
- RLS policies govern browser access. Security-definer RPCs provide narrowly
  scoped transactional or privileged operations.
- Realtime feeds booking/queue changes to the client. The Edge Function
  dispatcher delivers supported background notifications.
- Monetary values are stored as integer paise. The app does not connect a
  payment gateway.

## 2. Apply database migrations

Use the Supabase SQL Editor or Supabase CLI in a non-production environment
first. Apply the numbered files in order:

1. `001_foundation_and_tenants.sql`
2. `002_salon_operations.sql`
3. `003_offers_and_bookings.sql`
4. `004_queue_notifications_and_customer_features.sql`
5. `005_settings_audit_and_integrity.sql`
6. `006_rls_policies.sql`
7. `007_rpc_helpers_and_realtime.sql`
8. `008_seed_demo_data.sql` (optional; comments only)
9. `009_tenant_integrity_hardening.sql`
10. `010_admin_sessions.sql`
11. `011_queue_arrival_policy.sql`
12. `012_auto_assign_bookings.sql`
13. `013_live_salon_floor.sql`
14. `014_queue_notifications.sql`
15. `015_queue_event_generation.sql`
16. `016_notification_delivery.sql`
17. `017_customer_self_service.sql`
18. `018_booking_availability_and_admin_notifications.sql`
19. `019_smart_leave_reminder_location.sql`
20. `020_booking_location_and_notification_clear_fixes.sql`
21. `021_admin_clear_appointments.sql`
22. `022_single_active_booking_travel_reminders.sql`
23. `023_customer_notification_clear.sql`

For an existing installation at version 022, apply migration 023. Migration
022 stops with an explicit error if a customer already has multiple active
bookings; resolve those bookings with the salon owner before retrying. Do not run
`BOOKSALOON_ALL_MIGRATIONS.sql` on an existing database; doing so can replay
schema changes.

Migration 019 adds `location_description`, `location_source`, and
`location_updated_at` to `salons`. Latitude/longitude already exist and have
coordinate bounds. Existing salon update policies continue to control who can
change this information. The Smart Leave customer-origin location is not stored
in the database.

### Migration responsibilities

- **001–009:** foundation, tenant entities, services/bookings, RLS, RPC and
  realtime support, data integrity and cross-tenant hardening.
- **010:** server-managed administrator sessions and issue/validate/revoke RPCs.
  A fourth device session replaces the oldest active session.
- **011–014:** queue-arrival policies, assignment helpers, live floor state,
  and queue notifications.
- **015–016:** deterministic queue/booking notification events and privileged,
  leased notification delivery.
- **017:** customer self-service functions, notification deletion, and OTP
  storage/consumption for password recovery.
- **018:** administrator notification access and booking availability checks,
  including floor status, shifts, breaks, leave, staff service skills, and
  conflicting assignments. Unavailable staff should result in queueing rather
  than an invalid approval.
- **019:** salon location metadata for Smart Leave reminders.
- **020:** fixes customer-side barber availability selection, keeps unassigned
  bookings waiting with no false zero-minute ETA, rechecks staff availability
  during admin approval, makes location-column setup idempotent, and adds
  authenticated notification-clear RPCs for customers and salon
  administrators. Admin clear removes unread and read rows.
- **021:** adds an authorized admin RPC to permanently clear appointments for
  the selected salon, including related queue and booking records.
- **022:** enforces one active booking per customer and adds scheduled travel
  reminder notifications.
- **023:** refreshes the customer notification-clear RPC and adds a
  customer-owned RLS deletion fallback.

## 3. Configure Supabase Auth

The customer UI accepts Indian mobile numbers and passwords. The current
implementation maps the number to a private email alias for Supabase password
authentication; the number remains the identifier shown in the UI.

In the Supabase Dashboard:

1. Enable the Email Auth provider and new-user sign-up.
2. Configure email confirmation consistently with the alias-based registration
   flow. If confirmation is enabled, make sure the confirmation workflow is
   usable with generated aliases.
3. Do not enable phone OTP authentication unless an SMS provider and an
   intentional phone-auth flow are configured.
4. Set a suitable password policy and Auth rate limits.
5. Create customer accounts through the application and verify sign-up,
   sign-in, session restoration, sign-out, and reset using a test account.

The frontend does not contain a list of administrator credentials. Admin users
must be created through Auth and separately authorized by a trusted
administrator process. The authorization record is in `platform_admins`; do
not expose an RPC or frontend action that allows users to promote themselves.

Use the `create_salon(...)` onboarding RPC for owner/salon creation rather than
separate browser inserts into `salons` and `salon_members`.

## 4. Local frontend configuration

At the repository root, copy `.env.example` to `.env.local` and provide only
browser-safe values:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

`VITE_VAPID_PUBLIC_KEY` is optional unless browser push is enabled. Never put
`SUPABASE_SERVICE_ROLE_KEY`, a Firebase private key, `VAPID_PRIVATE_KEY`,
`DISPATCHER_SECRET`, or Android signing credentials in `.env.local` under a
`VITE_` name. Vite variables are delivered to browser code.

## 5. Deploy password reset

The `reset-password-by-phone` Edge Function handles two actions:

1. `request`: validates an Indian phone number, creates a random four-digit
   demo OTP, stores only a keyed hash and expiry in `password_reset_otps`, and
   returns the code for display in the test UI.
2. `reset`: validates the code and new password, consumes the OTP through the
   database RPC, and updates the password using the Supabase Auth Admin API.

Deploy after migration 017:

```powershell
supabase functions deploy reset-password-by-phone
```

The Supabase-hosted function needs its normal server-side Supabase URL and
service-role environment. Configure secrets through the Supabase Dashboard or
the CLI's secrets interface, never through frontend variables.

**Demo-only behavior:** the OTP is currently returned to and displayed by the
application, and there is no SMS delivery integration. Do not expose this flow
as secure production phone verification. Before production, integrate an SMS
provider in the trusted function, stop returning the OTP, set provider secrets
server-side, and test expiry, throttling, invalid attempts, and account
enumeration behavior.

## 6. Configure background push delivery (optional)

The application supports browser Web Push and Android FCM registration, but
actual delivery requires external credentials and user permission.

### Web Push

1. Generate a VAPID key pair using a trusted local tool.
2. Put only the public key in `VITE_VAPID_PUBLIC_KEY`.
3. Store the private key and subject as Edge Function secrets.
4. Serve the app from an HTTPS origin with the service worker available.
5. Test subscription registration, preference changes, and delivery in a
   non-production project.

### Android FCM

1. Register an Android Firebase app for package `com.booksaloon.app`.
2. Place the real `google-services.json` at `android/app/google-services.json`.
   It is local-only and must not be committed.
3. Configure the Firebase project ID, service-account email, and private key
   as server-side dispatcher secrets.
4. Build and install the app, grant notification permission, and test device
   registration and delivery on a physical Android device.

### Notification dispatcher secrets

The `dispatch-queue-notifications` Edge Function expects trusted server-side
configuration for Supabase access, the dispatcher authorization secret, the
allowed frontend origin, and the relevant VAPID/FCM credentials. Use the
Supabase Dashboard or `supabase secrets set` with real values locally. Never
commit these values or call the privileged dispatcher directly from browser
code.

Deploy:

```powershell
supabase functions deploy dispatch-queue-notifications
```

The dispatcher claims events through the service-role-only
`claim_queue_notification_events(integer, integer)` RPC. Migration 016 uses
leases and `FOR UPDATE SKIP LOCKED` to avoid concurrent duplicate claims,
tracks per-device attempts, and supports bounded retries. Migration 022 adds
scheduled travel-reminder events; run the dispatcher on a recurring schedule
(for example, once per minute) so reminders are sent at their due time. Delivery
respects user platform and notification-category preferences. Configure
`DISPATCHER_ALLOWED_ORIGIN` to the exact trusted frontend origin.

## 7. Data access and security notes

- Review every RLS policy against the actual roles and tenant boundaries before
  production.
- Do not let browser clients create arbitrary `booking_staff` or
  `booking_resources` assignments. Booking and assignment must be validated
  by trusted transactional logic.
- Exclusion constraints protect active staff/resource time overlaps; they do
  not replace a full transactional booking workflow.
- Migration 009 hardens customer/salon ownership and same-salon references.
- Migration 018 checks operational availability before booking approval; use
  these trusted paths instead of relying on UI-only validation.
- `chair.status` is an operational display value. Actual schedule conflicts
  are represented by active resource assignments and constraints.
- Queue dates and displayed times must be interpreted consistently in the
  salon timezone.
- Customer origin coordinates for Smart Leave are calculated on the device
  only after the customer enables the reminder and are never written to
  Supabase. Android requests foreground location permission at app startup;
  that permission request does not read or store location coordinates.
- `payment_status` is tracking only. No card data or payment processing is
  implemented.
- Add storage buckets and access policies deliberately if salon logos, staff
  photos, or service images move to Supabase Storage.

## 8. Suggested staging verification

Use disposable users and salons in a non-production project.

### Accounts and tenant access

- Register, sign in, restore a session after reload, and sign out as a customer.
- Verify one salon's users cannot read or modify another salon's protected data.
- Verify only explicitly authorized accounts can create an admin session.
- Log in from multiple admin devices and verify the configured session limit.

### Bookings and queue

- Book an available service and verify exactly one booking/queue record and the
  expected status/ETA.
- Try a barber who is offline, on leave/break, unskilled for the service, or
  already assigned; verify no false approval and correct waiting-queue result.
- Change queue status and ETA; verify the customer screen and admin dashboard
  update consistently.
- Exercise cancellation, completion, expired queue entries, and repeat events.

### Notifications

- Verify each event appears once and respects browser/Android and
  queue/booking preference flags.
- Register multiple devices and test partial, temporary, permanent, and
  successful delivery outcomes.
- Verify expired processing leases can be reclaimed, and a successful device
  is not needlessly retried.
- Verify invalid Web Push subscriptions and FCM tokens are revoked as intended.

### Password reset and Smart Leave

- Check OTP expiry and throttling; verify invalid or consumed codes cannot reset
  passwords.
- Verify the OTP is not delivered by SMS until a provider is integrated.
- Test Smart Leave with valid salon coordinates, denied permission, poor
  location accuracy, a changed queue ETA, cancellation, completion, and user
  disable. Confirm no customer-origin coordinates are persisted remotely.

## 9. Frontend and Android checks

From the repository root:

```powershell
npm ci
npm test
npm run lint
npm run build
npx.cmd cap sync android
```

Build a debug APK from the Android project directory:

```powershell
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

Real push delivery, production auth settings, migration behavior, and physical
device location/notification UX require separate staging and device tests.
