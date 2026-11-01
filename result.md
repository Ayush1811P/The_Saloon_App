## Latest Repository Configuration Result

### Single repository

- The Saloon website and Capacitor Android application remain in one repository.
- Shared React/Vite source is built once into `dist/`; Capacitor packages that output.
- No duplicate frontend or second repository was created.

### Workflows added

- `.github/workflows/website-deploy.yml` builds and validates the website on `main` and manual dispatch.
- `.github/workflows/android-build.yml` independently builds the shared frontend, synchronizes Capacitor, builds a debug APK with JDK 21, verifies it, and uploads it as an artifact.
- Android workflow path filters cover shared frontend, web assets, Capacitor, Android, dependencies, build configuration, and the workflow itself.
- No hosting provider configuration exists in the repository, so website CI does not invent deployment credentials or perform an unconfigured deployment.

### Validation

- `npm ci` — successful.
- `npm run build` — successful.
- `npm run lint` — completed with existing warnings.
- `npx.cmd cap sync android` — successful.
- Android debug APK previously built successfully with JDK 21.
- Current Android workflow is configured to reproduce that build on GitHub Actions.

### Documentation

- README now documents repository separation, website and Android commands, workflow behavior, environment variables, Firebase setup, required secrets, and bundled-asset update behavior.

### Remaining manual actions

- Configure the chosen website hosting provider if deployment should be performed by GitHub Actions; no Netlify/Vercel configuration is currently present.
- Add the real `android/app/google-services.json` for `com.booksaloon.app` if FCM delivery is required.
- Perform physical-device tests for notifications, notification taps, permissions, deep links, offline behavior, keyboard behavior, and token revocation.