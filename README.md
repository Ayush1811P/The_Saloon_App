# The Saloon

The Saloon is maintained in one repository as a React/Vite website and a Capacitor Android application. The website is the shared source of truth: Android packages the same production `dist/` output and does not maintain a second frontend.

## Repository layout

- `src/`, `frontend/`, `public/` — shared React application and web assets.
- `capacitor.config.json` — Capacitor app ID, name, and `dist` web directory.
- `android/` — native Capacitor Android project, branding, permissions, and notification integration.
- `supabase/` and `booksaloon_supabase/` — backend functions and database migrations.
- `.github/workflows/website-deploy.yml` — independent website build validation.
- `.github/workflows/android-build.yml` — independent Android debug APK build.

## Website development

```text
npm ci
npm run dev
npm run build
npm run lint
```

The production build is written to `dist/`. Vite receives browser-safe configuration through `VITE_` variables only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_VAPID_PUBLIC_KEY` (required only for Web Push)

Never put Supabase service-role keys, Firebase service-account credentials, VAPID private keys, dispatcher secrets, or signing passwords in `VITE_` variables.

No Netlify or Vercel configuration is currently present in this repository. The website workflow builds and validates `dist/` but does not deploy to an unconfigured provider. Use the existing hosting provider's Git integration, or add its documented credentials and deployment configuration before enabling a deployment step.

## Android development

The Android application uses:

- Name: `The Saloon`
- Application ID: `com.booksaloon.app`
- Capacitor web directory: `dist`
- Minimum SDK: 24
- Target/compile SDK: 36
- Java: 21

Build the bundled website and synchronize Capacitor:

```text
npm ci
npm run build
npx.cmd cap sync android
```

Then build the debug APK:

```text
cd android
gradlew.bat assembleDebug
```

The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. `android/local.properties` is machine-specific and must not be committed.

## GitHub Actions

Both workflows run independently on `main` and can also be started manually:

- `website-deploy.yml` installs from `package-lock.json`, builds the website, and validates `dist/index.html`.
- `android-build.yml` installs Node.js and JDK 21, configures Android SDK packages, builds the shared frontend, runs Capacitor sync, builds `assembleDebug`, verifies the APK, and uploads it as an artifact.

The Android workflow is path-filtered to frontend, Capacitor, Android, dependency, build, and workflow changes. Neither workflow waits for or triggers the other, so an Android failure cannot block website validation and there is no push loop.

## Firebase and secrets

FCM code is present, but the real Firebase Android configuration is not committed. Obtain the Firebase Android app configuration for package `com.booksaloon.app` and place it locally at:

```text
android/app/google-services.json
```

That file is ignored by Git. Do not create a fake file or commit Firebase private credentials. Production Supabase service-role keys, Firebase service-account keys, VAPID private keys, dispatcher secrets, and Android signing credentials belong in the relevant Supabase or GitHub Actions secret store only.

The debug workflow does not require Firebase credentials to compile. FCM delivery, notification taps, and token revocation require the real Firebase configuration, backend configuration, and a physical-device test.

## Website updates and installed apps

Every Android build packages the latest successful shared frontend build into the APK. Existing installed APKs do not receive bundled website changes automatically. After a website change, distribute a newly built and signed APK or Android App Bundle through the chosen release channel; users must install the new version to receive the updated bundled assets.
