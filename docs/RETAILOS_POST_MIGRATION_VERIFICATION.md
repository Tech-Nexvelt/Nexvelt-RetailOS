# RetailOS — apply the migrations and verify the hosted project

Project ref `dlxgvpmvlwbqxogyzlhr` · approved manifest `ab468e4fbed8` · 16 migrations (`…000_fresh_project_guard` first, `…015_schema_marker` last).

Every step is tagged:
* **[LOCAL]** runs on your machine with no hosted database. Already run and passing; rerun any time.
* **[HOSTED]** needs the migrated hosted database. **None of these have been run.** Do not treat the hosted project as ready until each one is recorded as passed.
* **[DASHBOARD]** is a manual Supabase or hosting-platform action.

Nothing in this file is applied by Claude: you run the migration. The verification scripts are read-only and never apply anything.

---
## Part A — before you migrate

### A1 [LOCAL] Prove the files are the approved ones
```powershell
cd E:\Softwares\NexveltretailOS
npm run retailos:manifest:check          # must print: Manifest OK (21 files)
(Get-FileHash supabase\retailos\MANIFEST.sha256 -Algorithm SHA256).Hash.Substring(0,12).ToLower()   # must be ab468e4fbed8
# each of the 16 migrations against SHA256SUMS (PowerShell has no sha256sum):
$bad=0; $n=0; Get-Content supabase\retailos\migrations\SHA256SUMS | Where-Object { $_.Trim() } | ForEach-Object {
  $h,$f = $_.Trim() -split '\s+',2; $f=$f.TrimStart('*'); $n++
  if ((Get-FileHash "supabase\retailos\migrations\$f" -Algorithm SHA256).Hash.ToLower() -ne $h) { $bad++; "DIFFERS  $f" } }
"checked $n migrations, $bad differ"        # must print: checked 16 migrations, 0 differ
```
Stop if any line differs. Do not edit a migration, `rollback.sql`, `bootstrap/first-tenant.sql` or anything in `verify/`: they are hash-pinned.

### A2 [LOCAL] Rerun the full local suite
```powershell
npm run typecheck; npm run lint; npm test; npm run schema:app-check; npm run test:db; npm run build
```
Expected: typecheck/lint clean, 251 unit tests, `OK application code is compatible…`, 228 database tests, build succeeds.

### A3 [DASHBOARD] Auth settings that must be true BEFORE you migrate
| Setting | Value |
|---|---|
| Authentication → Hooks | **none** configured (the guard and post-checks reject a project with an auth hook or an `auth.users` trigger) |
| Project must be empty | no tables, functions or triggers created by hand (the guard refuses otherwise) |

### A4 [HOSTED, read-only] Confirm the target is clean (database connection only)
Put the connection string in `.env.local` with the helper (hidden input; never paste it anywhere):
```powershell
node scripts/set-secret.mjs dburl        # type/paste the CURRENT database password
node scripts/hosted-preflight.mjs --db-only
```
Expected: every line PASS, ending `PREFLIGHT PASSED (read-only)`. It checks: TLS verified against the Supabase CA, `postgres` on PostgreSQL 17+, Supabase roles present, **no** `retailos` schemas, no application objects, no trigger on `auth.users`, and a dry run of the guard in a read-only transaction.
If it says `password authentication failed`, the stored password is wrong: reset it in the dashboard once, then rerun `set-secret.mjs dburl` (paste, do not retype).

### A5 [DASHBOARD] Apply the migrations (you do this)
Either run `node scripts/hosted-apply.mjs --i-have-run-the-preflight` yourself (one transaction per file, guard first, stops at the FIRST failure, never reruns), or paste the files into the Supabase SQL editor in order, each inside `begin; … commit;`, as `postgres`.
If anything fails: **stop**. Do not rerun. Inspect the actual state with the read-only query in A6 and send the output; a partially applied set must be assessed, not retried.

---
## Part B — verify the migrated schema

### B1 [HOSTED, read-only] Schema, RLS, grants, functions, triggers
```powershell
node scripts/hosted-verify.mjs --db-only
```
Expected: all PASS, ending `VERIFICATION PASSED for everything that ran.` It checks, in one read-only transaction that is always rolled back:
* the 11 post-checks return zero rows (RLS on every table; no table privilege for `anon`; no function callable by `anon`/PUBLIC; every `SECURITY DEFINER` function has a fixed `search_path`; no open or `using (true)` policy except the two global permission-catalogue reads; ledger tables have no API write privilege; no `auth.users` trigger; nothing in `public`; schema marker correct);
* the live schema equals `supabase/retailos/verify/expected_inventory.txt` line for line (1013 lines);
* `retailos.schema_info` = `retailos / 1 / dedicated-project-v1`;
* `anon` and a signed-in user with no membership read no row of any tenant table (the three global permission-catalogue tables are excluded by design).
The Data API line prints `BLOCKED` in `--db-only` mode: that is expected, it is covered in B3.

### B2 [HOSTED, read-only] Optional psql comparison
```powershell
psql "<your session-pooler string>" -At -f supabase/retailos/verify/inventory.sql > inventory-actual.txt
npm run retailos:verify:schema -- inventory-actual.txt     # must print: Schema matches the expected inventory (1013 lines)
```

### B3 [DASHBOARD] Expose the schema (only after B1 passed)
Project Settings → Data API → **Exposed schemas**: add **`retailos`**. Do **not** add `retailos_private` (it must stay unreachable through the API). Keep `public` as Supabase has it. Save.
Check from any machine (no secret needed beyond the publishable key):
```powershell
$ref="dlxgvpmvlwbqxogyzlhr"; $pub="<publishable key>"
# retailos reachable but empty to an anonymous caller (401/permission denied or []), retailos_private must be refused:
curl.exe -s -o NUL -w "retailos_private: %{http_code}\n" -H "apikey: $pub" -H "Accept-Profile: retailos_private" "https://$ref.supabase.co/rest/v1/"
```
Expected for `retailos_private`: an error status (406/404), never 200 with a schema listing.

---
## Part C — Auth dashboard configuration [DASHBOARD]
| # | Setting | Value | Why |
|---|---|---|---|
| C1 | Authentication → Sign In / Providers → **Allow new users to sign up** | **off** | access is by invitation only |
| C2 | Email provider | enabled, **Confirm email on** | |
| C3 | URL configuration → **Site URL** | your production **https** URL | must equal `NEXT_PUBLIC_SITE_URL` |
| C4 | URL configuration → **Redirect URLs** | add `<site url>/auth/confirm` | invite and reset links land there |
| C5 | Authentication → **SMTP Settings** | a custom SMTP provider | Supabase's built-in sender is limited to a few emails per hour and is for testing; staff invitations and password resets will fail or be throttled without real SMTP |
| C6 | Authentication → Rate Limits | review the defaults | the app relies on these for login throttling |
| C7 | Database → Backups | note the plan; take a manual backup before real data | recovery |

---
## Part D — create the owner and the first business

### D1 [DASHBOARD] Owner login
Authentication → Users → **Add user** → *Create new user*: the owner's email and a strong password, **Auto Confirm User** ticked. (With sign-up off, this is the only way to create the first login.)

### D2 [HOSTED] Tenant bootstrap — run a COPY, never edit the repo file
```powershell
Copy-Item supabase\retailos\bootstrap\first-tenant.sql $env:TEMP\first-tenant.mine.sql
notepad $env:TEMP\first-tenant.mine.sql
```
Edit only the five constants at the top: `v_owner_email` (the login from D1), `v_trade_name`, `v_legal_name`, `v_state_code` (exactly 2 characters; confirm with the business), `v_tenant_code` (2–10 capitals/digits). Paste the whole edited file into the **SQL editor** and run it once. Expected message: `Done. <email> is now the owner of <name> (branch MAIN, counter C1).` It is idempotent; leaving a `REPLACE_` value makes it stop. Delete the temp copy afterwards.
(The repo file is hash-pinned; editing it in place breaks `retailos:manifest:check`.)

### D3 [HOSTED, read-only] Confirm the bootstrap
```sql
select t.code, t.trade_name, b.code as branch, c.code as counter
from retailos.tenants t join retailos.branches b on b.tenant_id = t.id join retailos.counters c on c.branch_id = b.id;
select r.key, m.status from retailos.tenant_memberships m join retailos.roles r on r.id = m.role_id;   -- expect tenant_owner / ACTIVE
```

---
## Part E — environment for the running app

Local run against the hosted project (optional smoke test before deploying) uses `.env.local` with the five application variables from Part F, then `npm run build; npm start`. Set `BILLING_BACKEND=supabase`. Never use `demo` against real data (it refuses to run in a production build).

---
## Part F — hosting-platform environment variables [DASHBOARD]
Set these in the hosting platform (for Vercel: Project → Settings → Environment Variables, scope **Production**; add **Preview** only if you want preview deployments to use this project). Values are not in this repository and are not invented here.

| Name | Browser-visible | Value comes from | Notes |
|---|---|---|---|
| `BILLING_BACKEND` | no | type `supabase` | anything else is refused in production |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://dlxgvpmvlwbqxogyzlhr.supabase.co` | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (designed to be public) | Supabase → Project Settings → API Keys → **publishable** key (`sb_publishable_…`) | RLS, not secrecy, protects data. Never put a secret key here. |
| `NEXT_PUBLIC_SITE_URL` | yes | your production **https** origin, no trailing path (same as C3) | email links are built from it, never from request headers; `localhost` is rejected in production |
| `SUPABASE_SECRET_KEY` | **no — server only** | Supabase → API Keys → **secret** key (`sb_secret_…`) | only used to invite staff. Mark it *Sensitive* if the platform offers that. **Never** give it a `NEXT_PUBLIC_` prefix. |

Do **not** set `RETAILOS_DATABASE_URL`, `RETAILOS_DB_CA_FILE`, `SUPABASE_ACCESS_TOKEN`, `RETAILOS_SUPABASE_PROJECT_REF` or any database password in the hosting platform: the application never reads them.
`NEXT_PUBLIC_*` values are compiled into the build, so **redeploy after changing them**.

### F1 [LOCAL] Validate without printing values
```powershell
$env:NODE_ENV="production"; npm run env:check     # OK/PROBLEM per variable; secrets are never printed
```
After the build, the browser bundle must not contain the secret key (it is server-only): `Select-String -Path .next\static -Pattern "sb_secret_","service_role" -Recurse` must find nothing.

---
## Part G — functional tests on the hosted app (test data only; no real payments)
Run in order, after A–F pass. Record each result; do not mark a step done unless it ran.

**G1 Login and role access [HOSTED]**
1. Open the app signed out → any page redirects to `/login?next=…`. Sign in as the owner → lands on `/dashboard`; navigation shows Billing, Products & Stock, Sales, Reports, Settings.
2. Reload and wait; the session persists. Sign out → `/billing` redirects to `/login`.
3. Settings → invite a test cashier (a real mailbox you control; needs C5 and `SUPABASE_SECRET_KEY`). Open the email link → set password → the cashier lands on `/billing` and sees **only** Billing. Typing `/settings` or `/reports` in the address bar must not show those pages.
4. A login with no membership must land on `/no-access`.

**G2 Product creation and inventory [HOSTED]**
1. Products & Stock → **New product** → Clothing: name, category, size, colour, price, opening stock → Save. Expect the product in the list with that stock.
2. Open the product → adjust stock (pick a reason from the list; the default is "count correction"). Expect the new count and a recorded movement; an adjustment that would make stock negative must be refused.
3. Add one imitation-jewellery piece (one tagged item). Expect it listed as "1 piece".

**G3 Checkout, payment, receipt [HOSTED]**
1. Billing → enter opening cash → **Start day**.
2. Scan or type the product barcode → cash payment for more than the total → change is shown → **Complete bill**. Expect `Bill saved: <number>`.
3. Press the same complete action twice quickly, or refresh and resubmit: exactly **one** bill must exist (idempotency). Check Sales.
4. Sell the jewellery piece by **UPI**: *Complete bill* stays disabled until "Payment received" is ticked; UPI/card are recorded as confirmed, not verified with a bank.
5. Open the bill → **Reprint receipt**: prices as sold, "Paid by …", "DUPLICATE COPY", and a clear "No tax applied" line if tax is not configured.
6. Try to sell the same one-off jewellery piece again: refused (already sold).
7. Stock for the clothing item decreased by the quantity sold.

**G4 Sales history and reports [HOSTED]**
1. Sales lists both bills, newest first, with correct totals and payment method.
2. Reports for today: total, bill count and the by-method split equal the sum of the bills. Set From after To → "The dates are the wrong way round." A range over a year is refused with a message.

**G5 Isolation between two businesses [HOSTED]** — the most important test
1. Create a second login (D1) and a second business by running a **copy** of the bootstrap with a different owner email, trade name and `v_tenant_code` (D2).
2. Sign in as business B's owner. Products, Sales and Reports must be **empty**; none of A's products, bills or numbers appear.
3. Copy the URL of one of A's bills (`/sales/<id>`) while signed in as B → must show "not found"/no access, never the receipt.
4. Reverse: A must not see B's data.
5. [HOSTED, read-only] `node scripts/hosted-verify.mjs --db-only` again. It must still end `VERIFICATION PASSED`.

---
## Part H — what is NOT verified or not built (honest list)
* Part B–G have **not** been run against the hosted project. Local tests prove the SQL and the app logic on embedded PostgreSQL with a Supabase-like shim, not Supabase itself (real Auth, the Data API, email delivery and the pooler are not exercised locally).
* Not built as screens (database functions exist for some): voiding a bill, metal-rate management, category management, archiving products, stock/low-stock reports, exports, tax reports.
* Security headers: `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` and `Strict-Transport-Security: max-age=31536000` (this host only) are set. There is **no Content-Security-Policy**: it needs testing against the running app before enabling. Login throttling relies on Supabase Auth's own limits (C6); the app only relays the "Too many attempts" response.
* Hygiene still owed by you: reset the database password that was exposed in chat and revoke any access token ever pasted into chat.

---
## Part I — Phone scanner (optional feature; no migration needed)
Full description, security controls, configuration and an honest test matrix: **`docs/RETAILOS_PHONE_SCANNER.md`**.
* **Enable:** set the server-only variable `SCANNER_PAIRING_SECRET` (32+ random characters, different per environment) in the hosting platform. Without it the Connect button explains that the scanner is not set up. `npm run env:check` reports it.
* **Needs https:** a phone browser will not open the camera on an `http://` address.
* **Hosted test you can repeat without a phone (two browser tabs):** Billing -> Phone scanner -> Connect -> copy the link -> open it in a second tab -> Connect -> expect "Connected" on both -> use "Type a barcode instead" on the second tab -> the item appears in the Billing cart.
* **Still to do on your side:** a real phone scanning real barcodes over https (not verified; the camera path is covered only by mocked tests).
