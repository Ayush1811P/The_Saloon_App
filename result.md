# BOOKSALOON Netlify Environment and API Audit

## 1. Required Netlify environment variables

| Variable | Required | Type | Location | Purpose | Source |
|---|---|---|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Public | Frontend | Supabase project URL used by the client | Supabase Project Settings |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public | Frontend | Supabase anonymous/publishable client key | Supabase Project Settings > API |

These are the only environment variables referenced by the application. No service-role key, secret key, payment key, SMS key, email key, or Netlify Function secret is currently used.

## 2. External integrations

### Supabase

Supabase is used for:

- Customer and admin authentication
- Services and pricing
- Staff
- Business hours
- Bookings
- Queue management
- Notifications
- Admin sessions
- Realtime updates

Relevant files:

- `src/lib/supabase.js`
- `src/lib/adminService.js`
- `src/App.jsx`
- `booksaloon_supabase/migrations/`

### Unsplash

Mock salon images use public Unsplash URLs in `src/data/mockData.js`. No API key is required.

## 3. Security audit

### Verified

- Admin passwords are not hardcoded in the source.
- No service-role key is referenced by frontend code.
- `.env.local` is ignored by `.gitignore`.
- `.env.local` is not tracked by Git.
- Admin credentials are validated through Supabase Auth.
- Admin authorization uses the `platform_admins` table.
- The maximum three active admin sessions rule is enforced by the database RPC.
- `public.issue_admin_session(text)` is called with `p_user_agent`.

### Required security action

Supabase secret/service-role credentials were previously shared outside the repository. Rotate or revoke those credentials immediately in Supabase. Do not commit them or add them to any `VITE_*` variable.

### Risks and limitations

1. Admin session validation occurs when the dashboard mounts or performs protected operations. A revoked device may remain visually open until its next validation.
2. No Netlify Functions or server API currently exists.
3. No independent scheduler currently calls `expire_overdue_queue_entries()`. The admin dashboard invokes it while refreshing the live queue.
4. `src/lib/supabase.js` has demo fallback values when environment variables are missing. Production deployment requires both variables.
5. `vite.config.js` uses `server.allowedHosts: true`, which is intended for development tunneling and does not affect the Netlify production bundle.

## 4. Netlify compatibility

The project is compatible with Netlify as a static Vite application.

```text
Build command: npm run build
Publish directory: dist
Base directory: /
```

Netlify Functions are not currently required.

## 5. SPA routing requirement

React Router is used, but no `netlify.toml` or `_redirects` file currently exists. Add this redirect before deployment:

```text
/*    /index.html   200
```

Without it, direct visits to routes such as `/admin/login` or `/customer/home` may return a Netlify 404.

## 6. Supabase deployment requirements

Apply migrations `001` through `011`, including:

- `booksaloon_supabase/migrations/010_admin_sessions.sql`
- `booksaloon_supabase/migrations/011_queue_arrival_policy.sql`

Confirm that:

1. The admin Auth user exists.
2. The admin user UUID exists in `public.platform_admins`.
3. At least one salon exists in `public.salons`.
4. Required Supabase Realtime tables are enabled.
5. RLS policies are enabled.

## 7. Netlify deployment steps

1. Import the GitHub repository into Netlify.
2. Set the build command to `npm run build`.
3. Set the publish directory to `dist`.
4. Add `VITE_SUPABASE_URL` in the production environment.
5. Add `VITE_SUPABASE_ANON_KEY` in the production environment.
6. Do not add service-role or secret keys.
7. Add the SPA redirect shown above.
8. Deploy the site.
9. Test `/`, `/login`, `/register`, `/admin/login`, and `/admin/dashboard`.
10. Check the browser console and Network panel for Supabase errors.

## 8. Validation performed

- Production build completed successfully.
- Lint completed with existing unused-import and React hook warnings.
- No tracked secret values were found in source files.
