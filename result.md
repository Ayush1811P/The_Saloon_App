# The Saloon — Project and Build Report

**Status checked:** 6 November 2026
**Repository:** `Ayush1811P/The_Saloon_App`
**Android application ID:** `com.booksaloon.app`

This report describes the current checked-out project and the latest local
validation. It is not a claim that the Supabase database has been migrated, the
website has been deployed, or physical devices have been tested.

## 1. Product summary

The Saloon is a salon discovery, booking, and queue application with two
connected clients:

- A responsive React website.
- An Android application built with Capacitor that bundles the website's
  production frontend.

Supabase provides the configured authentication, relational data, tenant
access control, RPCs, realtime changes, and optional notification delivery.
Website and Android share the same React source; Android does not have a
separate booking UI.

## 2. Features by role

### Public visitors

- View the public landing page and how the salon booking/queue experience is
  intended to work.
- Enter customer registration or login.
- See a download-app call to action. A real APK store/download URL has not yet
  been configured, so the button is presentation-only.

### Customers

- Register and sign in using an Indian mobile number and password.
- Restore an existing customer session on app reopen and route to the customer
  home.
- Browse salon and service information and use the booking experience backed
  by the configured project.
- Review bookings and appointment status in **My Bookings**.
- Clear the visible booking history on the current device. This hides entries
  locally; it does not cancel the underlying appointments.
- View account/profile information and customer notifications.
- Clear customer notifications through the configured database permissions.
- View live queue status, estimated time remaining, and a queue progress bar.
  The queue screen uses its existing 30-second countdown and realtime updates.
- Enable a current appointment status notification and, where configured,
  register the device for future notifications.
- Reset a password by requesting a four-digit demo OTP, entering the code,
  and setting a new password. The code is currently displayed in the app for
  testing and is not sent by SMS.
- Optionally enable Smart Leave-Time Reminder for an active booking. This
  feature uses one-time foreground location and an approximate local travel
  calculation. The estimate follows queue timing changes; Android can schedule
  a local notification. The web reminder requires the queue page to remain
  visible for browser notifications.

### Salon administrators

Admin access requires an authorized account and a valid server-managed admin
session. Returning administrators are routed to the admin workspace. The
default section after admin login is **Handle Offline**.

The admin menu provides:

1. **Dashboard:** today's active queue and a manual query refresh.
2. **Handle Offline:** salon floor and walk-in service handling. Walk-ins do
   not require a customer name or phone number; a free barber is assigned
   automatically, or the service joins the waiting queue.
3. **Services & Pricing:** add/update services and prices and open/close a
   service.
4. **Staff Management:** review and update staff status.
5. **Business Hours:** configure operating hours.
6. **Salon Location:** save an address/landmark and coordinates, or capture,
   review, and confirm the current salon-device location for travel reminders.
7. **Waiting Time Settings:** maintain the queue's waiting-time settings.
8. **Appointments:** review bookings and appointment statuses.
9. **Notifications:** review salon notifications, mark them read, and clear
   notifications.
10. **Settings:** access salon settings exposed by the current workspace.

Booking availability is enforced by backend logic, not only by the UI. The
availability check includes barber floor state, working schedule, breaks,
leave, service skills, and conflicting assignments. When no eligible barber
is available, the appointment must stay in the queue rather than be approved
with a false assignment.

## 3. Smart Leave-Time Reminder details

The feature is optional. Android requests foreground location permission when
the app first opens; that permission request does not read coordinates. The
customer's one-time location is read only after enabling the reminder. The
website asks permission when the reminder is enabled. The feature does not
request background location and does not use a routing service.

Default estimate:

- Haversine straight-line distance using an Earth radius of 6,371 km.
- Road-distance approximation: straight-line distance × 1.30.
- Average city speed: 20 km/h; travel time rounds up to whole minutes.
- Preparation buffer: 3 minutes.
- Maximum accepted location accuracy: 1,000 metres.
- Local estimate lifetime: 12 hours.

The reminder compares the live estimated appointment start with travel time
and preparation time. A stable notification ID avoids creating a new Android
reminder for every ETA update. Booking cancellation/completion clears the
stored estimate and cancels pending reminders; the customer can also disable
the feature.

Only derived travel distance, travel minutes, accuracy, capture time, and
display details are kept temporarily in device-local storage. The customer's
origin coordinates are used in memory and are not sent to Supabase. Estimates
are approximate and are not a guarantee of route, traffic, or arrival time.

## 4. Architecture and important directories

| Path | Responsibility |
|---|---|
| `src/App.jsx` | Main routes, customer experience, administrator workspace, authentication UI |
| `frontend/src/components/LandingPage.jsx` | Public landing page used by the primary app |
| `src/components/queue/LiveQueueTracker.jsx` | Customer queue view and Smart Leave UI |
| `src/services/queueTrackerService.js` | Queue loading and realtime subscription |
| `src/services/platformNotificationAdapter.js` | Web/Android notification platform integration |
| `src/services/smartLeaveReminder.js` | Location validation, local estimate, reminder state and scheduling decisions |
| `src/lib/adminService.js` | Server-backed admin session lifecycle |
| `src/lib/supabase.js` | Browser Supabase client |
| `booksaloon_supabase/migrations/` | Ordered SQL schema, RLS, RPC and trigger migrations |
| `supabase/functions/` | Password reset and queue notification dispatcher |
| `android/` | Capacitor Android project and native queue notification integration |
| `tests/` | Node.js unit tests, including Smart Leave calculations and state changes |
| `.github/workflows/` | Website CI and Android debug build automation |

### Main routes

- `/` — public landing page, or the appropriate signed-in area.
- `/login`, `/register`, `/reset-password` — customer account screens.
- `/customer/home`, `/customer/bookings`, `/customer/queue/:bookingId`,
  `/customer/notifications`, `/customer/profile` — customer application.
- `/admin/login`, `/admin/dashboard` — administrator authentication and
  workspace.

Unauthenticated customer routes return to login. An authenticated customer
opening the application is redirected to customer home; a valid admin session
opens the admin dashboard.

## 5. Backend and integration status

Supabase migrations are numbered 001–021. Migration 019 adds salon location
description/source/update metadata; migration 020 reasserts those columns for
older installations, fixes customer booking and admin approval availability
checks, and adds authorized notification-clear RPCs. Existing projects at
migration 018 must apply migrations 019 and 020; projects at 019 should apply
migration 020. Migration 021 adds an authorized RPC for clearing all
appointments for the selected salon; apply it after migration 020.

The admin unified waiting queue now has an explicit refresh action that expires
overdue queue entries, refetches the floor, and shows refresh errors. Customer
and admin dropdown menus close on outside click or Escape and animate when
opening and closing. The admin Appointments section can permanently clear the
selected salon's bookings and related queue records; new appointments continue
to be stored normally.

The reset-password Edge Function uses a generated, expiring OTP and updates the
password using the Auth Admin API. SMS delivery is not configured. Background
notification delivery requires Web Push VAPID keys and/or real Firebase
credentials and a deployed, protected dispatcher. These secrets belong in
Supabase/server settings, not in frontend variables or source control.

No payment gateway is integrated. The app does not claim that a successful
compile proves that the backend configuration, deployment, notification
delivery, or device-specific behavior works.

## 6. Build and verification

The following checks completed locally:

- `npm test` — 14 tests passed.
- `npm run lint` — completed with existing project warnings.
- `npm run build` — completed; Vite reported the existing large-chunk advisory.
- `npx.cmd cap sync android` — completed and included Geolocation,
  Local Notifications, and Push Notifications plugins.
- Android `assembleDebug` — completed successfully.
- Merged Android manifest includes coarse/fine foreground location and no
  background-location permission.
- Android debug APK rebuilt successfully after the fixes.
- `git diff --check` — completed without whitespace errors.

The initial `npm ci` attempt was blocked because the already-running Vite
preview held a native dependency file open. Dependencies were restored using
`npm install`, after which the checks above passed. The lint warnings and
large-chunk advisory are not described as fixed.

### APK artifacts

- Current repository build output:
  `android\app\build\outputs\apk\debug\app-debug.apk`
- Build type: debug APK for development/testing
- The existing Desktop APK was intentionally left untouched for this task.
  No new APK was copied to the Desktop.

Install the debug APK on a compatible Android device for manual testing. A
release distribution requires an intentional release-signing and versioning
process.

## 7. Build commands

Website:

```powershell
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Android:

```powershell
npm run build
npx.cmd cap sync android
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

## 8. Automation and Git status

Website CI builds and validates the static output but does not deploy to a
hosting provider. The Android workflow builds the shared frontend, synchronizes
Capacitor, builds a debug APK, and uploads it as an Actions artifact.

No commit or push was made for this work. Review changes and secrets before
staging; `.env.local`, Firebase credentials, Supabase service-role credentials,
VAPID private keys, dispatcher secrets, and signing keys must remain private.

## 9. Remaining setup and release checks

1. Apply migrations 019 and 020 to the intended Supabase project (apply only
   020 if migration 019 is already installed).
2. Configure Supabase Auth and explicitly authorize administrator accounts.
3. Deploy/configure the password reset function; integrate a real SMS provider
   before production and remove demo OTP disclosure.
4. Configure Web Push and/or Firebase only if background push is required.
5. Run account, tenant-isolation, booking-availability, and notification
   checks against a non-production Supabase environment.
6. Install the APK on physical Android devices and test location consent,
   notification permission, queue updates, lifecycle/reopen behavior, and
   notification taps.
7. Configure a real download/distribution target for the landing-page app
   button and a hosting provider if website deployment is required.

Physical-device testing, production deployment, migration application, and
production notification delivery have not been verified by the local build.
