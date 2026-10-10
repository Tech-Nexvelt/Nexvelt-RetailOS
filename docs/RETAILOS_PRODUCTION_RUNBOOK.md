# RetailOS production migration — checklist and runbook

**Status: PREPARED, NOT EXECUTED. Awaiting your explicit approval.** Nothing here has been run against the live Supabase project. No backup exists yet (the live project reported 0 backups and no point-in-time recovery on 2026-10-10). Written 2026-10-10.

Legend used throughout: **VERIFIED** = I ran it and saw the result (command given). **YOU** = needs you (account, dashboard, decision, credentials). **UNVERIFIED** = cannot be proven without the hosted environment.

Related documents: `RETAILOS_PRODUCTION_PREFLIGHT.md` (what the SQL does, dry-run results), `RETAILOS_SCHEMA_MIGRATION_PLAN.md` (design), `TIRUMALA_SECURITY_FIXES_PROPOSED.md` (Tirumala-side risks).

---

## 1. Approval baseline: the exact bytes that would run

`supabase/retailos/MANIFEST.sha256` pins every production file. When you approve, you approve these hashes; the runbook's first step re-checks them.

```
dc44bd3731f00492c466a297490af221bf15098c35c3fbd6c9fabe131c1e50b1  migrations/20261010100001_foundation.sql
67fe45be88f26d204d2d37e7cb1c13f3312fe3bb0a6e823a4037b3b5d2de4868  migrations/20261010100002_tenancy.sql
8ba1e1cf1563c84552d58f903f08fceebbdd1af94ecaf751913d9624d84c5451  migrations/20261010100003_authz_rls.sql
38e946a3fe70e83abbc9388ded799fbe318b8702aafcd0d7f1f7b2bb710ddb7b  migrations/20261010100004_audit.sql
c0bed639b74130b4b2e2a6410a0917c18e314336c7119b08e97c13ea4c0648cc  migrations/20261010100005_tenancy_rpc.sql
36881cca29428705c7051b3dfbc4cd6f119cef2fe451fdd2c9b9afc4117257d4  migrations/20261010100006_catalogue.sql
0621ad473753c92a354a704355a93a2f59eba91181971c78aad5634f1b185d0c  migrations/20261010100007_inventory.sql
7294657ce1753d352110281d4ae1ba4109a5924b79f38a39e0dbd8ef53ffc54c  migrations/20261010100008_sales.sql
9bc107536ccc46f7cb317ea3faf2e2e2c7819ba7b50ca9d104e89219ed321ae8  migrations/20261010100009_checkout.sql
3df409b4aed5d86bd6691b3a130118e95573e65b26c67a94f68f7c708b2982b7  migrations/20261010100010_metal_rates.sql
a35fbcfd48f22bd84be13f2bad4964a22090f299b243aca8e980226101f3b069  migrations/20261010100011_reports.sql
de34ee78b413601b0682b0eeb5b746e9fc2847ae5bd708a1472a1a0b1db5fb72  migrations/20261010100012_permission_management.sql
969fd2642dd3ee003e962ec6ed9437df481029615d60359e95bc796e52ebce44  migrations/20261010100013_void.sql
1e5d2b5af00f20556ea080d71e81aeb0b9ef41d46223ed675d11e05c05bc59c6  migrations/20261010100014_catalog_create.sql
747d075839a63512a25a5479d00721808753540ef6ca358706bc02a88f380043  bootstrap/first-tenant.sql
ac244b36f2169a9c59b8ea8d2fa0d32459ec4739f58740349b9f34d7b59485c4  rollback.sql
9b34c62310bc209b992433323850fa54ef8b9b25f90fb652c217ce30caf0673d  verify/post_checks.sql
ca5c63dab00516885356d56bdee573245e8c8a0a2edc451a7e1276b9606dc157  verify/row_counts.sql
9bcb90bcfda217d3cad8942541b01e73b099667b1b446d0bc978e18b30efb6a9  verify/snapshot.sql
```

**Unchanged since the successful dry run (VERIFIED today):**

| Claim | Command | Result |
|---|---|---|
| Original `supabase/migrations/` untouched | `cd supabase/migrations; sha256sum -c SHA256SUMS` | 14/14 OK |
| Adapted migrations match their seal | `cd supabase/retailos/migrations; sha256sum -c SHA256SUMS` | 14/14 OK |
| Adapted migrations are reproducible from the originals | `npm run retailos:port`, then compare hashes before/after | byte-identical; seal identical |
| `rollback.sql` unchanged | file compared before/after the regeneration | identical |
| Production file set pinned | `npm run retailos:manifest:check` | `Manifest OK (19 files)` |

One change since the dry run, **not** to a migration or the rollback: the header comment of `bootstrap/first-tenant.sql` used to say the migrations are "in supabase/migrations" (the unsafe original set); it now says `supabase/retailos/migrations (NOT supabase/migrations)`. Comment-only; the manifest was regenerated for it. No independent record of file hashes exists from the moment of the dry run other than the seal and the byte-identical regeneration; treat the manifest above as the baseline from here on.

---

## 2. Final checklist of preconditions

Every line must be ✅ before the apply step. Status as of now.

### A. Decisions and approvals (YOU)
| # | Precondition | Status |
|---|---|---|
| A1 | Written approval of the manifest in section 1 (14 migrations, bootstrap, rollback, verify queries) | YOU |
| A2 | Decision on public sign-ups (`TIRUMALA_SECURITY_FIXES_PROPOSED.md`, part 1) | YOU |
| A3 | Decision on each Tirumala SQL fix T1–T4 (part 2 there): apply now / later / never | YOU |
| A4 | Accept the operational constraint: an Auth user who holds a RetailOS profile cannot be deleted in the dashboard until that profile is removed (`ON DELETE RESTRICT`) | YOU |
| A5 | Accept that Supabase Dashboard exposure of schema `retailos` makes the 10 existing tables reachable over REST for signed-in users (RLS applies; all are empty) | YOU |
| A6 | Choose the maintenance window and tell Tirumala's operators (no downtime expected) | YOU |
| A7 | Confirm whether a paid Supabase branch dry run is wanted (not created; cost not approved) | YOU |

### B. Backup (YOU; I will not claim it exists)
| # | Precondition | Status |
|---|---|---|
| B1 | Manual export taken per section 3 (data + schema + grants/policies/triggers/functions) | YOU, **not done** |
| B2 | Export content verified with `npm run backup:verify` (all PASS) | YOU, after B1 |
| B3 | Export stored outside the repo, off this machine too, access-controlled (contains Tirumala's data and password hashes if `auth` is included) | YOU |
| B4 | Row counts captured at backup time (`verify/row_counts.sql`) and kept with the dump | YOU |

### C. Access (YOU)
| # | Precondition | Status |
|---|---|---|
| C1 | A way to run SQL as role `postgres`: Supabase **session pooler** or direct connection string (Dashboard → Connect), exported as environment variables in your own terminal, never in chat | YOU |
| C2 | `psql` 17 and `pg_dump` 17 available: install PostgreSQL 17 command-line tools, **or** Docker Desktop running (the repo machine has Docker 29.7.2 installed, daemon was not running); no `psql`/`pg_dump` on this machine today | YOU |
| C3 | Service-role key rotated and the personal access token that was pasted into chat earlier revoked | YOU |

### D. Environment and code (partly verified)
| # | Precondition | Status |
|---|---|---|
| D1 | Env variables set per section 4, `npm run env:check` all OK | YOU (checker VERIFIED) |
| D2 | `NEXT_PUBLIC_SITE_URL` chosen (the public https URL of the deployed app) | YOU |
| D3 | typecheck / lint / build / unit / DB / clone-DB suites pass on the commit being deployed | VERIFIED 2026-10-10 (results in section 8) |
| D4 | Demo mode refused in production (503 on a real production server) | VERIFIED |
| D5 | Nothing committed yet: the repository has **no git commits**; commit before deploying so the exact code is recoverable | YOU / me on request |

### E. Tirumala safety
| # | Precondition | Status |
|---|---|---|
| E1 | Re-run the read-only catalog snapshot immediately before apply; hashes `tirumala`, `live`, `auth_triggers` must equal those from the 2026-10-10 audit baseline or be explained | at run time |
| E2 | The 10 `retailos_*` tables still have 0 rows | at run time |
| E3 | No new objects in schema `retailos` besides the 10 tables and no new triggers on `auth.users` | at run time |

### F. Dashboard (YOU, after the SQL; listed in section 5, steps 8–11)
Expose `retailos` in the Data API; sign-up setting per A2; Site URL and redirect allow-list; email (SMTP) for invites.

---

## 3. Manual database export (backup)

**Do not rely on `rollback.sql` for protection of Tirumala:** it never touches Tirumala, so it cannot restore it. A backup protects against the unexpected.

### 3.1 What the export must contain
Schema **and data** for `public`, `cms`, `auth_custom`, `retailos`: tables, views, functions, RLS policies, grants (ACLs), default privileges, triggers, plus (recommended) the `auth` schema so Tirumala's `auth.users` trigger and users are recoverable. Estimated size is small (Tirumala has ~320 products and ~10 invoices).

### 3.2 Get a connection (YOU, in your own terminal; never paste these into chat)
Dashboard → **Connect** → *Session pooler* (works over IPv4; the direct host is IPv6-only on some plans). Use its host/port/user/password as environment variables (PowerShell):

```powershell
$env:PGHOST = "<pooler host>"; $env:PGPORT = "5432"; $env:PGUSER = "postgres.<project-ref>"
$env:PGDATABASE = "postgres"; $env:PGSSLMODE = "require"
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host -AsSecureString "DB password")).Password   # works in Windows PowerShell 5.1 and 7
```
(Port 5432 session pooler, not 6543 transaction pooler.)

### 3.3 Tools
* If you installed PostgreSQL 17 client tools: use `pg_dump` / `pg_restore` / `psql` directly.
* If you use Docker instead, define wrappers once per terminal (names only, no secrets, are passed to the container):
```powershell
function pg_dump    { docker run --rm -i -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGSSLMODE -e PGPASSWORD -v "${PWD}:/work" -w /work postgres:17 pg_dump @args }
function pg_restore { docker run --rm -i -v "${PWD}:/work" -w /work postgres:17 pg_restore @args }
function psql       { docker run --rm -i -e PGHOST -e PGPORT -e PGUSER -e PGDATABASE -e PGSSLMODE -e PGPASSWORD -v "${PWD}:/work" -w /work postgres:17 psql @args }
```

### 3.4 Take the export (read-only operations)
```powershell
New-Item -ItemType Directory -Force backups | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmm"

# 1) application schemas, schema + data, custom format (owners and privileges are KEPT: no --no-owner / --no-privileges)
pg_dump --format=custom --schema=public --schema=cms --schema=auth_custom --schema=retailos --file="backups/apps-$stamp.dump"

# 2) auth schema (users, identities, and the trigger Tirumala has on auth.users); reference copy, see note below
pg_dump --format=custom --schema=auth --file="backups/auth-$stamp.dump"

# 3) greppable schema-only SQL of the application schemas (policies, functions, grants in plain text)
pg_dump --schema-only --schema=public --schema=cms --schema=auth_custom --schema=retailos --file="backups/apps-schema-$stamp.sql"

# 4) exact row counts at this moment
psql --csv --file=supabase/retailos/verify/row_counts.sql --output="backups/counts-$stamp.csv"
```
Note: restoring the `auth` dump over a live Supabase project needs care and is **not** part of the rollback plan; it exists so Tirumala's users and trigger definition are not lost.

### 3.5 Verify the export (no restore needed)
```powershell
pg_restore --list "backups/apps-$stamp.dump" > "backups/apps-$stamp.list.txt"
pg_restore --data-only --file="backups/apps-$stamp.data.sql" "backups/apps-$stamp.dump"
npm run backup:verify -- --listing "backups/apps-$stamp.list.txt" --data "backups/apps-$stamp.data.sql" --counts "backups/counts-$stamp.csv"
```
Expected: every line `PASS` (tables 39, table data 39, views 5, functions 19, policies 58, RLS flags 39, triggers 18, grants present, default privileges present, the 10 `retailos_*` tables present, and per-table row counts equal the live counts). A `WARN` for the auth trigger is normal here because it lives in the `auth` dump. Then confirm the auth trigger is in the auth dump:
```powershell
pg_restore --list "backups/auth-$stamp.dump" | Select-String "trg_on_auth_user_created"
```
(If that prints nothing, the `auth` dump did not capture the trigger; then save the output of `select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;` next to the dump.)

`npm run backup:verify` is tested (`src/ops-scripts.test.ts`) against fabricated listings, including broken ones; **it has not been run against a real dump** because none exists. It proves the dump's contents, **not** that a restore works. If you can, rehearse a restore of `apps-*.dump` into a scratch PostgreSQL 17 (create roles `anon`, `authenticated`, `service_role`, `supabase_admin`, `supabase_auth_admin` and a stub `auth.users(id uuid primary key)` first); I have not rehearsed this.

### 3.6 What "confirmed" means
Reply with: the date/time of the export, the file names, and the `backup:verify` result (not the files, not any credential). I will record "backup confirmed by owner" only after that, and not before.

---

## 4. Environment variables

Set these where the app runs (hosting dashboard for production, `.env.local` locally). **Values go only there, never into chat or the repository.** Check without printing values:

```powershell
$env:NODE_ENV = "production"; npm run env:check
```
Output is OK / PROBLEM per name. It also catches: a secret key placed in a public variable, a demo setting, a localhost site URL in production, a missing secret.

| Variable | Required | Browser-visible | Notes |
|---|---|---|---|
| `BILLING_BACKEND` | yes | no | exactly `supabase` in production. `demo` is refused outside development (503). |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` **or** `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes (one) | yes | public by design; the publishable name wins if both are set. Must **not** be a service-role/secret key. |
| `NEXT_PUBLIC_SITE_URL` | **yes** | yes | the deployed app's public `https://` URL, no trailing path. Required: invitation and password-reset links are built from it, never from request headers. It was missing from the variable list you gave me. Must not be localhost in production. |
| `SUPABASE_SECRET_KEY` **or** `SUPABASE_SERVICE_ROLE_KEY` | yes (one) | **no, never** | server-only; used only to invite staff. Never prefix with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | no (app does not read it) | no | only your operator tooling uses a connection string; keep it out of the app's environment. |

The Data API's **Exposed schemas** list is a dashboard setting, not an environment variable (step 8).

---

## 5. Production runbook

Run only after section 2 is all ✅. Operator: you, with me supervising. **Nothing runs until you say go.** Terminal: PowerShell in the repo root, with the `PG*` variables from 3.2 set. `psql` means the native tool or the Docker wrapper from 3.3.

### Step 0 — Freeze and sanity (read-only)
```powershell
npm run retailos:manifest:check         # must print: Manifest OK (19 files)
cd supabase\migrations; sha256sum -c SHA256SUMS; cd ..\..   # originals untouched (reference only; never applied)
psql -At -c "select current_user, version();"      # must be user postgres.<ref> and PostgreSQL 17.x
```
**STOP if:** manifest differs; not PostgreSQL 17; you are not connected to the intended project.

### Step 1 — Backup (section 3) — confirmed by you.
**STOP if:** `backup:verify` has any FAIL, or you have not confirmed.

### Step 2 — Pre-change snapshot (read-only)
```powershell
psql -At -f supabase/retailos/verify/snapshot.sql | Tee-Object backups/snapshot-before.txt
psql --csv -f supabase/retailos/verify/row_counts.sql | Tee-Object backups/counts-before.csv
```
`snapshot.sql` prints four hashes in this order: `tirumala`, `live`, `auth_triggers`, `retailos_schema`. Keep the file.
**STOP if:** any `retailos_*` table has rows; `retailos` holds anything besides the 10 tables; `auth_triggers` differs from the audited value (one trigger, `trg_on_auth_user_created`); Tirumala's row counts differ unexpectedly from the backup counts (someone is writing — decide whether to proceed).

### Step 3 — Apply the migrations, in order, each in its own transaction, stopping on the first error
```powershell
$files = Get-ChildItem supabase\retailos\migrations\*.sql | Sort-Object Name
foreach ($f in $files) {
  Write-Host "Applying $($f.Name)"
  psql -v ON_ERROR_STOP=1 --single-transaction `
       -c "set local lock_timeout = '5s'" -c "set local statement_timeout = '120s'" -f $f.FullName
  if ($LASTEXITCODE -ne 0) { Write-Host "STOPPED at $($f.Name). Do not continue."; break }
}
```
Each file commits only if it fully succeeds. Expected: no errors, a few seconds in total. The lock timeout makes a file fail rather than wait if the brief lock needed on `auth.users` (for the `profiles` foreign key) is contended.
**STOP and go to the rollback decision (section 6) if:** any file fails; any output mentions `public.` objects, `permission denied`, or `already exists` for a name that is not ours.
Do **not** edit a migration to "fix" a failure on the fly: the manifest hash would no longer match what you approved. Stop and report.

### Step 4 — Post-change verification (read-only)
```powershell
psql -At -f supabase/retailos/verify/snapshot.sql | Tee-Object backups/snapshot-after.txt
Compare-Object (Get-Content backups/snapshot-before.txt) (Get-Content backups/snapshot-after.txt)
psql -f supabase/retailos/verify/post_checks.sql
psql --csv -f supabase/retailos/verify/row_counts.sql | Tee-Object backups/counts-after.csv
```
Required results:
* `snapshot`: lines 1, 2, 3 (`tirumala`, `live`, `auth_triggers`) **identical** before and after. Line 4 (`retailos_schema`) **differs** (expected: schema USAGE for `service_role`, default privileges changed).
* `post_checks.sql`: **every one of its 7 result sets is `(0 rows)`**.
* Tirumala row counts unchanged; 10 live tables still 0 rows; the new tables exist.
**STOP and consider rollback if:** line 1, 2 or 3 differs; any post-check returns a row.

### Step 5 — Owner login (YOU, dashboard)
Authentication → Users → Add user (email + password, auto-confirm). Note: Tirumala's trigger will create a Tirumala profile for this user with role `admin` and no store (see Tirumala proposal T1). Tell me the **email only**.

### Step 6 — Bootstrap the first business
Copy the template out of the repository so the pinned file stays unmodified, edit the five values (`REPLACE_*`; the owner email, the 2-character state code NR Collections must confirm, business names, tenant code), and run it as `postgres`:
```powershell
Copy-Item supabase\retailos\bootstrap\first-tenant.sql $env:TEMP\first-tenant.edit.sql
notepad $env:TEMP\first-tenant.edit.sql
psql -v ON_ERROR_STOP=1 --single-transaction -f $env:TEMP\first-tenant.edit.sql
```
Expected notice: `Done. <email> is now the owner of NR Collections (branch MAIN, counter C1).` It sets no tax rate, no GSTIN, no address.
**STOP if:** the script reports the login was not found or the state code is invalid; fix the input, do not edit SQL.

### Step 7 — Re-run post-checks (read-only)
`psql -f supabase/retailos/verify/post_checks.sql` again: all `(0 rows)`.

### Step 8 — Expose the schema (YOU, dashboard)
Settings → API → **Exposed schemas**: add `retailos` (keep `public, graphql_public, cms`). **Do not add `retailos_private`.** Save. (Reversible: remove it.)

### Step 9 — Dashboard configuration (YOU)
Sign-up setting per decision A2; Site URL = the value of `NEXT_PUBLIC_SITE_URL`; add it (and `/auth/confirm`) to redirect URLs; configure SMTP so invites send.

### Step 10 — Smoke tests with a real login (YOU + me; section 7 lists what each one proves)
1. Sign in as the owner on the deployed app → lands on the dashboard.
2. Settings: set tax mode; add one product with stock; confirm it appears under Products.
3. Billing: start the day, scan, pay cash, complete → invoice number, receipt prints; the sale appears in Sales; stock decreased by exactly the quantity; the dashboard shows it.
4. Retry safety: complete the same bill twice quickly → one invoice only.
5. Invite a cashier; sign in as them → lands on Billing; cannot open `/reports`, `/settings`, `/products` (redirected).
6. A login with **no** RetailOS membership (e.g. an existing Tirumala user) → sees nothing / no-access.
7. **Tirumala still works**: sign in to Tirumala's app, load products/invoices, create or open an invoice.
**STOP and consider rollback if:** step 7 fails, or a membership-less login can see any RetailOS data.

### Step 11 — Deployment (separate approval)
Deploying the app is a separate step and needs its own approval after steps 0–10 pass.

---

## 6. Rollback criteria and stop conditions

### 6.1 When to roll back (`supabase/retailos/rollback.sql`)
Roll back only when **no real sales exist yet** and one of: a verification query in step 4 fails; Tirumala's smoke test fails and the cause is plausibly this change; a migration fails midway in a way you cannot resolve (each failing file already rolled back its own transaction, so earlier files remain applied).
```powershell
psql -v ON_ERROR_STOP=1 -f supabase\retailos\rollback.sql      # contains its own begin/commit
psql -At -f supabase/retailos/verify/snapshot.sql              # lines 1-4 must now equal the "before" snapshot
```
It drops 22 functions and 35 tables by exact name and the `retailos_private` schema; it restores the `retailos` schema USAGE and default privilege. It never drops schema `retailos` and never touches `public`, `auth`, `cms`, `auth_custom` or the 10 live tables.
**Limits (read before deciding):** all data in the new tables is lost (bootstrap rows, any sales); Auth users created in step 5/10 and invitations are not undone; dashboard changes (schema exposure, sign-up/URL settings) are not undone: reverse them by hand. After real sales exist **do not roll back**: restore from backup or fix forward.

### 6.2 Stop conditions (do not continue; report; wait)
| Condition | Action |
|---|---|
| Manifest check fails | stop; a production file differs from what was approved |
| No confirmed, verified backup | stop |
| Connected role is not `postgres`, or server is not PostgreSQL 17 | stop |
| Any `retailos_*` table has rows, or unexpected objects in `retailos` / new triggers on `auth.users` | stop; the live state changed since the audit |
| Any migration file errors | stop; do not edit SQL; report the exact message |
| Pre/post snapshot lines 1–3 differ | stop; consider rollback |
| Any `post_checks.sql` query returns a row | stop; consider rollback |
| Tirumala sign-in or invoice flow fails after the change | stop; consider rollback; check dashboard changes first |
| A membership-less login can read RetailOS data | stop; roll back; do not deploy |
| Anything surprising you cannot explain | stop; ask |

---

## 7. What still needs the hosted environment

| Check | Needs | Why it cannot be proven locally |
|---|---|---|
| Migrations apply on the real server | hosted Supabase (ideally a branch/clone) | the local clone has no data, no Supabase platform internals, a different PostgreSQL build |
| Data API serves `retailos` (`Accept-Profile: retailos`), RPC calls work, function/table grants work through PostgREST | Data API exposure (step 8) | local tests call the database directly; only headers were captured |
| Login, logout, password reset, invite email, set-password link | real Supabase Auth + SMTP + Site URL | local tests use a fake auth shim; demo mode has no login |
| Owner/cashier authorisation end to end | real authentication | the demo role is a cookie |
| Membership-less user is refused through the real API | real auth + exposure | proven at database level on the clone only |
| Real browser to real database checkout (cash/UPI/card/split, retry, receipt, ledger) | real browser + real DB | the browser pass used the in-memory demo engine; the database checkout is proven by 200+ DB tests, never through the UI |
| Tirumala's app unaffected | Tirumala's real app and real data | not available to me; step 10.7 is yours |
| Product create/edit and stock adjustment from the UI | real DB | demo mode refuses these |
| Settings save, tax mode, staff invite | real DB + Auth admin key | same |
| Performance with real data and locks on `auth.users` | production-like data | clone has no rows |

---

## 8. Verification results behind this document (2026-10-10, local only)

| Command | Result |
|---|---|
| `npm run typecheck` / `lint` / `build` | all passed |
| `npm test` | **251/251** passed (19 files), including 8 tests for the backup verifier and env checker and the manifest test |
| `npm run test:db` | **220 passed, 5 skipped** (the 5 clone-only fidelity tests skip without the local clone) |
| `npm run test:db:clone` | **225/225** passed on the catalog-faithful clone (migrations, snapshots, post-checks, rollback, row-count query) |
| `npm run retailos:manifest:check` | `Manifest OK (19 files)` |
| `npm run env:check`, `npm run backup:verify` | run only against fabricated inputs in tests; **not** against real environment or a real dump |

## 9. Files and commands introduced for this phase
`supabase/retailos/MANIFEST.sha256`, `supabase/retailos/verify/row_counts.sql`, `scripts/retailos-manifest.mjs`, `scripts/verify-backup.mjs`, `scripts/env-check.mjs`, `src/ops-scripts.test.ts`; npm scripts `retailos:manifest`, `retailos:manifest:check`, `env:check`, `backup:verify`; `scripts/port-to-retailos.mjs` (bootstrap header pointer); tests `src/retailos-migrations.test.ts` (manifest test), `tests/db/isolation.test.ts` (row-count query test).
