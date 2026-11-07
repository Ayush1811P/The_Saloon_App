# The Saloon

The Saloon is a salon discovery, appointment, and live-queue application. It is
delivered as a responsive React website and a Capacitor Android app. Both use
the same frontend and Supabase project; the Android app bundles the production
website inside its WebView.

## What the application does

### Public website

- Presents the salon brand, services, sample queue experience, booking flow,
  and account entry points.
- Includes a styled app-download call to action. A distribution URL still needs
  to be supplied before the button can download an APK.
- Sends signed-in customers and administrators to their respective app areas.

### Customer account and appointments

- Customers register and sign in with an Indian mobile number and password.
  Supabase Auth stores credentials when configured; the browser application
  does not store a plaintext password.
- The app restores a valid customer or administrator session when it opens and
  routes the user to the corresponding signed-in area.
- Customers can browse salons, view service information and prices, and use the
  available booking experience.
- **My Bookings** lists appointment information and provides a clear action.
  Clearing hides those bookings from that browser/device; it does not cancel
  appointments in the salon's database.
- The customer profile area displays account information.
- Password recovery accepts a mobile number, requests a four-digit demo OTP,
  and lets the customer set a new password. The code is currently displayed
  for testing; it is not delivered by SMS.

### Live queue and notifications

- The live queue view displays booking/queue status, a wait countdown, and a
  time-progress bar. It refreshes its countdown every 30 seconds, listens for
  realtime booking changes, and refreshes after connectivity returns.
- Customers can enable a current-status notification and register a supported
  device for future booking/queue updates.
- The Notifications page displays account notifications and can clear them.
- Web Push requires browser permission, a service worker, a VAPID public key,
  and configured server-side delivery. Android background push requires the
  real Firebase app configuration and server-side FCM credentials.
- A notification tap can open the related queue when platform configuration
  and notification payload support it.

### Optional Smart Leave-Time Reminder

On an active booking's queue page, a customer may explicitly enable this
reminder. Android requests foreground location permission when the app is first
opened; the website requests it when the customer enables the reminder. The
app only reads the customer's coordinates when the customer enables the
reminder, and calculates approximate travel time locally:

1. Validate the customer's current coordinates and salon coordinates.
2. Calculate straight-line distance using the Haversine formula.
3. Estimate road distance with a 1.30 detour multiplier.
4. Estimate travel time at 20 km/h and round up to whole minutes.
5. Add a three-minute preparation buffer and compare the result with the live
   queue start-time estimate.

These are configurable defaults in `src/services/smartLeaveReminder.js`; the
estimate is not a map route or traffic forecast. The queue page captures a
fresh one-time customer location, shows Google Maps directions to the salon,
and schedules a push reminder for the estimated leave time with a
three-minute preparation buffer. Android also schedules a local notification.
Browser push delivery requires an enabled push subscription and the configured
VAPID secrets; the in-page reminder remains available when push is unavailable.

Salon admins can search and confirm the map address, then add a house/shop,
building, floor, or named-place detail. Customers can add their own pickup
details as well. Reverse geocoding supplies available sector, district, city,
and state components; house numbers and floors must be entered by the person
who knows the exact address.

Customer origin coordinates are not sent to Supabase. The device temporarily
stores only derived travel information for up to 12 hours. Disabling the
reminder or ending the booking clears its saved estimate and cancels any
pending local reminder.

Salon administrators configure the destination under **Salon Location**.
They can search addresses, review the map pin, explicitly confirm it, or use
the current device location. Search results use OpenStreetMap and directions
open in Google Maps. Apply migrations 019 and 020 before using this setting.

### Administrator workspace

The admin area requires an authorized administrator account and a valid
server-issued admin session. The first section after login is **Handle
Offline**. The menu provides:

- **Dashboard** — today's live queue, periodic refresh, and a manual refresh
  action.
- **Handle Offline** — salon-floor operations and service-only walk-ins. A
  free eligible barber is assigned automatically; otherwise the service joins
  the waiting queue.
- **Services & Pricing** — create/update services, adjust prices and durations,
  and open or close services.
- **Staff Management** — view and update staff status.
- **Business Hours** — configure salon operating hours.
- **Salon Location** — configure and confirm the salon's reminder destination.
- **Waiting Time Settings** — maintain wait-time settings used by the queue.
- **Appointments** — review appointment records and statuses.
- **Notifications** — review salon notifications, mark them read, and clear
  notifications.
- **Settings** — access the available salon settings.

Booking approval checks must use the configured Supabase availability and
assignment logic. Barber schedules, current floor availability, breaks, leave,
service skills, and conflicting assignments affect whether an appointment can
be confirmed or must remain in the queue.

## Technology and repository layout

- `src/` — primary React application, customer/admin screens, queue UI, and
  application services.
- `frontend/src/components/LandingPage.jsx` — public landing page imported by
  the primary application.
- `public/` — public web assets and service worker.
- `src/lib/` — Supabase client and administrator-session helpers.
- `src/services/` — queue tracking, notification integration, and Smart Leave
  calculations.
- `booksaloon_supabase/migrations/` — ordered database migrations.
- `supabase/functions/` — password-reset and queue-notification Edge Functions.
- `android/` — Capacitor Android project, notification plugin integration,
  application branding, and Gradle build.
- `.github/workflows/` — independent website validation and Android APK build.
- `capacitor.config.json` — app identity and `dist` web directory.

Key dependencies are React, Vite, React Router, TanStack Query, Supabase,
Capacitor, Tailwind CSS, and Lucide icons. Android application ID:
`com.booksaloon.app`.

## Run the website locally

Requirements: Node.js 22 (or a compatible current LTS release), npm, and access
to a configured Supabase project for live account and database behavior.

1. Install the lockfile dependencies:

   ```powershell
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and set the browser-safe values:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
   ```

   The VAPID key is needed only for Web Push. Never put a Supabase
   service-role key, Firebase private key, VAPID private key, dispatcher secret,
   or signing password in a `VITE_` variable or browser bundle.

3. Start the development server:

   ```powershell
   npm run dev
   ```

4. Run checks and create a production website build:

   ```powershell
   npm test
   npm run lint
   npm run build
   ```

The Vite build is written to `dist/`. When Supabase environment variables are
missing, live backend features are not available; configure Supabase before
testing authentication, persistent bookings, queue data, or administrator
operations.

## Supabase setup

Database instructions, migrations, authentication configuration, Edge Function
secrets, push delivery setup, and operational notes are maintained in
[`booksaloon_supabase/README_SETUP.md`](./booksaloon_supabase/README_SETUP.md).
Apply migrations 001 through 023 in order to a new project. For an existing
project at migration 022, apply migration 023. Migration 022 checks for
customers with multiple active bookings and stops if any need to be resolved
before the one-active-booking constraint can be added. Migration 023 refreshes
the notification-clear RPC and adds an RLS-protected delete fallback. Do not rerun
`BOOKSALOON_ALL_MIGRATIONS.sql` on an existing database.

## Build the Android APK

Requirements: Node.js/npm, JDK 21, Android SDK (platform/build tools 36), and
the Android project configured for the local machine. The generated debug APK
does not require Firebase credentials to compile; background Firebase push
delivery does require real Firebase configuration.

From the repository root:

```powershell
npm ci
npm run build
npx.cmd cap sync android
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

The debug APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. To copy it to the current
Windows user's Desktop:

```powershell
Copy-Item android\app\build\outputs\apk\debug\app-debug.apk `
  "$env:USERPROFILE\Desktop\TheSaloon-latest.apk" -Force
```

To make the website's **Download our app** button serve that build, copy the
APK to `public/downloads/The Sallon app.apk` and run `npm run build` again.
Deploy the resulting `dist/` folder; Android asset packaging excludes APK
files so the download is not embedded inside the app itself.

A debug APK is for development/testing, not a Play Store release. A public
release should use a deliberately managed signing key and release build.
`android/local.properties` and `android/app/google-services.json` are
machine-specific/private and must not be committed.

### In-app updates

The website checks its service-worker registration for a waiting release and
shows an **Update app** button to customer and admin sessions. Deploying a new
website build changes the worker assets; users can apply that release from the
button without manually clearing browser data.

The Android app checks Google Play for an available immediate in-app update and
shows the same button when one is available. To release an Android update,
increment `versionCode` in `android/app/build.gradle`, build and sign the
release, then publish it to the same Google Play application track. Android
updates are discoverable only for Play-installed builds; sideloaded debug APKs
must be updated by installing a new APK manually.

## Automated workflows

- **Website CI** runs on pushes to `main` and manual dispatch. It installs
  dependencies, builds the website, and checks for `dist/index.html`. It does
  not deploy the site; no hosting-provider deployment is configured here.
- **Android debug build** runs on relevant changes to `main` and manual
  dispatch. It builds the shared frontend, synchronizes Capacitor, builds and
  verifies the debug APK, and uploads an Actions artifact for 14 days.

The two workflows run independently.

## Git workflow

The configured repository is
`https://github.com/Ayush1811P/The_Saloon_App.git`, on branch `main`, tracking
`origin/main`. Local Git is configured to set upstream on a first push and use
the simple push mode. Typical commands after reviewing the diff are:

```powershell
git status
git add <files>
git commit -m "Describe the change"
git push
```

Changes are not committed or pushed automatically. Review generated files and
secrets before staging; never commit `.env.local`, Firebase credentials,
service-role keys, signing keys, or other secrets.

## Limitations and production-readiness notes

- Password-reset OTP is a temporary demo code displayed in the application;
  no SMS provider sends it. Configure a provider and stop returning the OTP in
  the function response before production.
- Push delivery depends on browser/Firebase configuration, server-side secrets,
  user permission/preferences, and device registration. A successful build
  alone does not verify push delivery.
- Smart Leave uses an approximate distance/speed calculation. It is not a
  guaranteed arrival time. The web notification is not guaranteed after the
  page is closed.
- The app does not process payments. Payment-related values are tracking
  fields, not a payment gateway integration.
- Applying SQL migrations and building the APK do not verify a deployment or
  physical-device behavior. Test authentication, permissions, queue updates,
  notification taps, and location behavior on the intended platforms before
  release.
