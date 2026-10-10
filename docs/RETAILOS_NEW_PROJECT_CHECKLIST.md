# RetailOS — new dedicated Supabase project: setup checklist

Nothing in this file has been run against any hosted database. Steps marked **YOU** need the Supabase/Vercel dashboards.
Never paste a key, password or connection string into chat or a file in this repository.

## A. Create and identify the project (YOU)
1. Supabase dashboard → **New project**, in a *new* organisation or at least a *new project*; name it `nexvelt-retailos-prod`. Choose the region closest to the shop. Save the database password in your password manager only.
2. Tell me **only the project reference** (the `<ref>` in `https://<ref>.supabase.co`) and confirm it is **not** the Tirumala Furniture project. The reference is not a secret.
3. I will check the reference is different from the old shared project (recorded in `archive/shared-project/README.md`) before any connection is made.

## B. Dashboard settings (YOU) — before migrating
| Setting | Value | Why |
|---|---|---|
| Authentication → Sign In / Providers → Email | enabled; **"Confirm email" on** | owners/staff verify addresses |
| Authentication → **Allow new users to sign up** | **off** | access is by invitation only (`membership_grant`, admin invite) |
| Authentication → URL configuration | Site URL = production URL (https); add the same to Redirect URLs | email links come from `NEXT_PUBLIC_SITE_URL` |
| Authentication → Hooks | none | the guard/post-checks fail if a custom hook is present |
| Database → Extensions | leave defaults | no extra extension is required |
| Project Settings → Data API → **Exposed schemas** | add `retailos` (set **after** the migration, not before) | the app uses schema `retailos` |
| Database → Backups | note the plan; take a manual backup before real data | recovery |

Do **not** create any table, function, trigger or policy by hand. The project must be empty: migration `…000_fresh_project_guard.sql` refuses to run otherwise.

## C. What the migrations create (verified locally, 228 DB tests + 25 dedicated-project tests)
* Schemas `retailos` (36 tables, all with RLS enabled, none with any `anon` privilege) and `retailos_private` (helpers, no tables).
* Every function closed to `anon`/PUBLIC; every `SECURITY DEFINER` function has a fixed `search_path`.
* No trigger on `auth.users`; no object in `public`; sign-up grants nothing.
* Write-once schema marker `retailos.schema_info` (`retailos`, version 1, `dedicated-project-v1`).
* Ledger tables (`invoices`, `payments`, `inventory_movements`, `audit_logs`, …) have no write privilege for API roles; writes go only through RPCs.
* Exact expected shape: `supabase/retailos/verify/expected_inventory.txt` (1013 lines).

## D. Approval gate — what I need from you before I touch the hosted project
Reply with: **(1)** the project ref, **(2)** "settings in B are done", **(3)** the explicit approval: *"apply manifest `<first 12 chars of sha256 of MANIFEST.sha256>`"*. I print that hash from `npm run retailos:manifest:check` plus `sha256sum supabase/retailos/MANIFEST.sha256`.

## E. After approval (I do these; each stops on the first failure)
1. `npm run retailos:manifest:check` and `sha256sum -c supabase/retailos/migrations/SHA256SUMS` must pass.
2. Connect with a connection string you put in your own shell environment (I will not see or print it); confirm `current_database()`/host contains the approved ref **before** running anything.
3. Run migrations `…000` → `…015` in order, one transaction each, as `postgres`.
4. Run `verify/post_checks.sql` (every query must return zero rows) and `verify/inventory.sql`, then `npm run retailos:verify:schema -- inventory-actual.txt` (must report "matches").
5. Create the owner under Authentication → Users (**YOU**), edit the 5 values in `bootstrap/first-tenant.sql`, run it.
6. Hosted smoke test with test data only: sign-in, onboarding, product create, stock adjust, checkout, payment, idempotent retry, receipt, cross-tenant denial, void.

## F. Environment variables (set in the host, e.g. Vercel → Production; never in git)
| Variable | Public? | Value |
|---|---|---|
| `BILLING_BACKEND` | no | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | the publishable (anon) key |
| `NEXT_PUBLIC_SITE_URL` | yes | the https production URL |
| `SUPABASE_SECRET_KEY` | **server only** | the secret key (used only to invite staff) |

Check without printing: `NODE_ENV=production npm run env:check` (reports OK/PROBLEM per variable only).

## G. Release gates (all must be true before deploy)
1. Production build passes. 2. Required objects/RLS verified on the new project. 3. Hosted end-to-end sale succeeds. 4. Authorization + tenant-isolation checks pass on the hosted project. 5. Production env vars verified. 6. No unresolved critical defect.
