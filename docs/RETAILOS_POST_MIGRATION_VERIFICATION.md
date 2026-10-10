# RetailOS — post-migration verification and release readiness

You apply the migrations yourself. Nothing here applies, rolls back or edits migrations. The scripts named below are read-only.
Nothing was verified against the hosted database when this file was written: sections 2 and 3 are **pending your migration**.

## 1. Local checks (run now; no database, no network)
| Command | What it proves |
|---|---|
| `npm run typecheck` / `npm run lint` | types and lint |
| `npm test` | 251 unit tests: billing engine, money, auth context, env rules, migration static guards |
| `npm run test:db` | 228 tests on embedded PostgreSQL 17 with a Supabase-like shim: RLS, tenant isolation, RBAC, checkout, idempotency, concurrency, guard, rollback round trip |
| `npm run build` | production build |
| `npm run retailos:manifest:check` | the SQL files are exactly the approved manifest (`ab468e4fbed8`) |
| `npm run schema:app-check` | every table, column, RPC and RPC argument the app uses exists in the approved schema |
| `npm run env:check` | environment variables are present and well formed (OK/PROBLEM only; no values printed) |

## 2. Hosted database checks (run AFTER you applied the migrations; read-only)
Prerequisite: `RETAILOS_DATABASE_URL` (session pooler, port 5432) and `RETAILOS_DB_CA_FILE` in `.env.local`, set with `node scripts/set-secret.mjs dburl`.
1. `node scripts/hosted-preflight.mjs --db-only` — **before** migrating it must pass (empty target). After migrating it is expected to FAIL on "no RetailOS schemas yet"; that is correct and means the schema exists.
2. `node scripts/hosted-verify.mjs --db-only` — read-only transaction, always rolled back. Checks: the 11 post-checks return zero rows (RLS everywhere, no anon access, no open or tautological policies, closed functions with fixed search_path, no auth hook, marker present); the live schema equals `verify/expected_inventory.txt` line for line (1013 lines); the schema marker; anon and a signed-in user without membership read no tenant rows.
3. `node scripts/verify-schema.mjs` offline comparer, if you prefer psql: `psql -At -f supabase/retailos/verify/inventory.sql > inventory-actual.txt` then `npm run retailos:verify:schema -- inventory-actual.txt`.

Not covered by these scripts (cannot be proven by reading the catalogue): cross-tenant isolation with two real businesses, a real sale through the hosted API, and email delivery. Section 4 covers them.

## 3. Manual Supabase dashboard actions (none can be verified by the scripts without the Management API)
| # | Action | When |
|---|---|---|
| 1 | Authentication → **Allow new users to sign up: off** | before real users |
| 2 | Authentication → Email provider on, **Confirm email on** | before real users |
| 3 | Authentication → URL configuration: Site URL = the production https URL; add it to Redirect URLs | before deploy |
| 4 | Authentication → Hooks: none | before migrating (the guard/post-checks require it) |
| 5 | Project Settings → Data API → **Exposed schemas: add `retailos`; never add `retailos_private`** | after sections 2 passes |
| 6 | Authentication → create the first owner (email, auto-confirm), then run `bootstrap/first-tenant.sql` after editing its 5 values | after section 2 passes |
| 7 | Reset the database password and revoke old access tokens that were ever pasted into chat | now |
| 8 | Database → Backups: note the plan; take a manual backup before real data | before go-live |

## 4. Hosted functional test (after sections 2 and 3; test data only, no real payments)
Sign in as the owner → create a product with opening stock → adjust stock → start the day → scan and sell for cash → repeat the same submission (must not create a second bill) → open the receipt → check Sales and Reports → void if enabled for the role. Then sign in as a user of a second test business and confirm none of the first business's products, sales or reports are visible. Record the results; do not mark any of them done until they ran.

## 5. Production environment variables (set in the hosting platform; never in git)
| Name | Public to the browser | Source |
|---|---|---|
| `BILLING_BACKEND` | no | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://dlxgvpmvlwbqxogyzlhr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (by design) | Project Settings → API Keys → publishable key |
| `NEXT_PUBLIC_SITE_URL` | yes | your production https URL (required; email links are built from it) |
| `SUPABASE_SECRET_KEY` | **no, server only** | Project Settings → API Keys → secret key (used only to invite staff) |

Do **not** set `RETAILOS_DATABASE_URL`, `RETAILOS_DB_CA_FILE`, `SUPABASE_ACCESS_TOKEN` or any database password in the hosting platform; the application does not read them. Check with `NODE_ENV=production npm run env:check`.

## 6. Known gaps and recommendations (not implemented; deliberately not added as features)
* **Rate limiting:** the app relays Supabase Auth's own rate-limit response ("Too many attempts") and has no limiter of its own. Supabase's per-IP limits apply; review them under Authentication → Rate Limits.
* **Security headers:** `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and `Permissions-Policy` are set. There is **no Content-Security-Policy and no HSTS** in `next.config.ts`. HSTS is normally added by the host on a custom domain; verify it after deploy. A CSP needs testing against the running app before enabling.
* **Wired in the database but with no screen yet:** voiding an invoice (`pos_void_invoice`), metal-rate management (`metal_rate_set`), category management, and archiving products. Stock reports and low-stock views are likewise not built. These are feature work, left out of this release on purpose.
* The demo billing backend refuses to run in production builds (`demo_forbidden`); that fail-closed behavior is covered by unit tests.
