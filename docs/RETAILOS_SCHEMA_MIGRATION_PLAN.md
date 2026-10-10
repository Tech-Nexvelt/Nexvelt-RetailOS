# RetailOS → `retailos` schema in the shared Tirumala Supabase project — migration map and plan

Status: **Nothing has been applied to the live project.** Prepared 2026-10-10. The port is now integrated in the repository (`supabase/retailos/`); the operational details (statement review, backup, execution order, rollback limits, exact SQL needing approval) are in `docs/RETAILOS_PRODUCTION_PREFLIGHT.md`. Where the two differ, the preflight report is current.
Approval given so far: *prepare and validate locally.* Not given: dropping tables, running production migrations, changing Tirumala, deploying.

## 0. What is verified and what is not

| Verified (live, read-only SELECTs on 2026-10-10) | Verified (local, embedded PostgreSQL 17) | NOT verified |
|---|---|---|
| Schemas, 10 `retailos.retailos_*` tables (all 0 rows), their RLS/policies/grants, 2 helper functions in `public`, Tirumala's trigger and policies, Data API exposed schemas (`public,graphql_public,cms`), sign-ups on, 1 user. | The ported migrations apply on a database *shaped like* the live one (fixture rebuilt from the audit); all 203 existing DB tests pass on `retailos`; 12 new isolation tests pass; a mutation check proves the isolation tests fail if a dangerous statement returns. | Anything on the real project after a migration; PostgREST behaviour with `retailos` exposed; real Supabase Auth flows; the fixture is a reconstruction, not a copy (other Tirumala objects, exact role settings and extensions are not reproduced). **Live compatibility is not claimed.** |

## 1. Live facts the plan is built on

* `retailos` already exists: owner `postgres`; `USAGE` granted to `authenticated` only; **default privilege** (role `postgres`, schema `retailos`) gives `authenticated` SELECT on every new table.
* 10 live tables (`retailos_tenants … retailos_payments`), RLS on, `anon` and `authenticated` hold full table privileges (RLS and missing schema `USAGE` for `anon` currently contain this). All empty.
* `public` belongs to Tirumala and already contains **`invoices`, `invoice_items`, `payments`, `products`, `categories`, `profiles`** (names the repo's old design also used) and `audit_log`, `stores`, etc.
* `auth.users` has one trigger: Tirumala's `trg_on_auth_user_created → public.handle_new_user()`.
* No `private` schema, **no `supabase_migrations` history table** (so `supabase db push` has no baseline; it must not be pointed at this project until the plan is approved).
* The Data API exposes `public,graphql_public,cms`. **`retailos` is not exposed.**

## 2. Migration map (repository → live)

### 2.1 Objects

| Repo (tested design) | Becomes | Live conflict? |
|---|---|---|
| 34 tables in `public` (`tenants`, `branches`, `products`, `invoices`, …) | the same names in **`retailos`** | None. No live name equals a repo name (live ones all carry the `retailos_` prefix). `invoices`/`payments`/`products`/`categories`/`profiles` would have collided in `public`. |
| 22 callable functions in `public` (`pos_checkout`, `inventory_adjust`, …) | `retailos.*` | None. |
| helper functions in `private` (permission checks, `fail`, `write_audit`, `build_quote`, …) | schema **`retailos_private`** (new, never exposed) | None (`private` is not used live; the generic name is avoided on purpose). |
| trigger `on_auth_user_created` on `auth.users` | **removed.** Replaced by `retailos_private.ensure_profile(uuid)`, called inside `platform_create_tenant` and `membership_grant` and the bootstrap script | Avoids a second trigger next to Tirumala's. A user who is never given a RetailOS membership never gets a RetailOS row. |
| table triggers (updated_at, audit, immutability) | unchanged, now on `retailos.*` | None |
| 47 RLS policies | unchanged, now on `retailos.*` | None |

Live → repo concept map (no data to carry over, all 0 rows): `retailos_tenants→tenants`, `_branches→branches`, `_memberships→tenant_memberships`+`branch_memberships`+`roles`, `_products/_product_variants→products/product_variants`, `_inventory→inventory_balances`, `_inventory_ledger→inventory_movements`, `_sales/_sale_items→invoices/invoice_items`, `_payments→payments`. The repo's design additionally has permissions/overrides, cash sessions, idempotency table, document sequences, audit log, tax classes/rates, jewellery items, metal rates and the 22 functions — none of which exist live.

### 2.2 Statements that had to be removed or redesigned

| Original | Why dangerous in the shared project | Ported as |
|---|---|---|
| `0001`: `alter default privileges revoke execute on functions from public` (**project-wide**) | changes the default for every future function Tirumala creates | **removed**. Every function is revoked from PUBLIC/anon explicitly (already done per function) and a test fails if one is missed. |
| `0001`: `alter default privileges in schema public revoke all on tables/functions/sequences …` | changes Tirumala's defaults | **replaced** by the same statements `in schema retailos` (our schema). Side effect to approve: it removes the *future-table* `authenticated SELECT` default in `retailos`; existing tables are unaffected. |
| `0003`: `revoke all on all tables in schema public from anon, authenticated` | **would strip Tirumala's access to all its tables** | **replaced** by a revoke on the 13 tenancy tables only (never "all tables in schema", so the 10 live tables keep their grants). |
| `0001/0003/0007/0009/0010/0014`: `revoke execute on all functions in schema private …` | would hit a Tirumala `private` schema if one existed | now targets `retailos_private` only. |
| `0001`: `create schema private` | generic name | `create schema if not exists retailos` and `retailos_private`. |
| `0002`: trigger on `auth.users` | see above | removed. |

Everything else is a mechanical rename (`public.`→`retailos.`, `private.`→`retailos_private.`). Functions already use `set search_path = ''` and schema-qualified names, so nothing depends on search_path.

### 2.3 Files to change (after approval)

| File | Change |
|---|---|
| `supabase/migrations/*.sql` (14) + `SHA256SUMS` | kept unchanged as the reference; the adapted set lives separately in `supabase/retailos/migrations/` (sealed with `npm run retailos:seal`). Generated by `scripts/port-to-retailos.mjs` (`scripts/port-to-retailos.mjs`). |
| `supabase/bootstrap/first-tenant.sql` | generated port (`retailos.*`) |
| `tests/db/harness.ts`, `fixtures.ts`, `shop.ts`, `catalog/checkout/concurrency/rbac/tenancy.rls.test.ts` | schema rename and 4 deliberate edits, see the git diff of `tests/db` (profile created explicitly; table-scanning tests exclude the 10 live tables; bootstrap path) |
| `tests/db/shim.sql` (unchanged) + **new** `tests/db/prodlike.sql` | live-shaped fixture |
| **new** `tests/db/isolation.test.ts` | 12 tests (section 5) |
| `src/lib/supabase/server.ts`, `client.ts`, `admin.ts` | pass `db: { schema: "retailos" }` (supported by supabase-js; `@supabase/ssr` forwards options). Every existing `.from()` / `.rpc()` call then targets `retailos` with no other code change. |
| `src/proxy.ts` | none (only validates the session; touches no tables) |
| `src/lib/env.ts`, `.env.example`, `src/lib/env.test.ts` | accept the names actually used (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) as aliases of the current names, keep the "no NEXT_PUBLIC secret" test |
| `src/server/auth/*` | none expected; invite flow keeps working through the same client option |
| `src/migrations.test.ts` | unchanged logic (still seals whatever is in `supabase/migrations`) |
| `docs/IMPLEMENTATION_TRACKER.md`, `DEPLOYMENT_RUNBOOK.md`, `SECURITY_MODEL.md` | update for the shared project |

## 3. How the app reaches `retailos`

* **Server and browser clients** use the publishable/anon key with `db: { schema: "retailos" }`; PostgREST then needs the `Accept-Profile: retailos` header (supabase-js adds it). The schema **must be in the exposed list**; otherwise requests fail with *PGRST106*.
* **Exposed schemas:** `public, graphql_public, cms, retailos`. `retailos_private` is **never** exposed; helpers are still reachable by RLS policies because `authenticated` has `USAGE` on it and `EXECUTE` is granted function by function.
* **Grants:** `USAGE` on `retailos` to `authenticated` (exists) and `service_role`; table/function grants are explicit in the migrations; `anon` gets nothing on the new objects (test-enforced).
* **Effect of exposing `retailos`:** the 10 live tables also become reachable over REST for `authenticated` (RLS policies exist and all are empty; `anon` still lacks schema `USAGE`).
* **Service-role key:** used only for Auth admin calls (inviting users), never for business tables. No browser bundle ever sees it.

## 4. Isolation model

* **RetailOS access = an ACTIVE row in `retailos.tenant_memberships` (and branch rows).** Nothing else grants it; roles never come from JWT metadata or sign-up data; signing in never creates a membership.
* **Tirumala access = `public.profiles` + its own policies.** RetailOS neither reads nor writes them.
* Proven locally (isolation tests): a Tirumala-only user, even with Tirumala's `admin` role, sees 0 RetailOS rows and cannot sell; a RetailOS cashier sees 0 of Tirumala's store data; a dual user gets each from its own source; a new sign-up gets no RetailOS profile/membership.
* **Open Tirumala-side holes** (not caused by RetailOS, not fixed here): see `docs/TIRUMALA_SECURITY_FIXES_PROPOSED.md`. One of them (`mobile_scans` readable by every signed-in user) is asserted by a clearly named "KNOWN TIRUMALA ISSUE" test, to be inverted when the fix is approved.

## 5. Tests that must pass before any production step

| Command | Required |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | clean |
| `npm test` (unit, 209 today + env alias tests) | all pass |
| `npm run test:db` | the 203 existing tests (ported) **plus** 12 `isolation.test.ts` = 215 pass |
| Isolation tests, which must stay green: | public schema hash unchanged; 10 live tables unchanged; `auth.users` triggers unchanged; no project-wide default privileges; no function runnable by anon/PUBLIC; anon has nothing on new tables; `ensure_profile` not callable by API roles; Tirumala-only user sees 0 RetailOS rows; RetailOS user sees 0 Tirumala store data; dual user separation |
| Mutation check | re-adding the original `revoke all on all tables in schema public` / global default-privilege statement must fail the isolation tests (done once in the spike: 5 tests failed) |

Spike result so far (scratch copy, not the repo): **215/215** DB tests pass.

## 6. Production migration plan (for approval — not to be run yet)

**Preconditions**
1. This plan, the generated migrations and the Tirumala proposals are reviewed and approved in writing.
2. Backup: confirm a dashboard backup/PITR exists; take a schema-only dump of `public`, `retailos`, `cms`, `auth_custom` (direct connection or SQL Editor export) and save the pre-change **catalog hashes** by running the two `TIRUMALA`/`LIVE` queries from `isolation.test.ts` read-only against the project.
3. Re-run the read-only catalog audit immediately before applying; stop if anything differs from section 1 (new tables, new triggers, rows in the `retailos_*` tables).
4. Preferably dry-run on a Supabase branch/clone, if the plan allows.
5. Choose the apply method: SQL Editor or `psql` with the migrations **in order, each wrapped in `BEGIN … COMMIT`**. No CLI `db push` (no history table exists).

**Apply** (about 15 minutes): migrations 0001–0014 in one transaction per file; then expose `retailos` in the Data API; then create the owner login (Auth) and run `retailos-bootstrap/first-tenant.sql` after replacing its placeholders.

**Validate right after**
* Re-run the two catalog-hash queries: `public` and the 10 live tables must equal the saved hashes (only `retailos` default-privileges and new objects may differ).
* Function check: no function in `retailos`/`retailos_private` executable by `anon`/PUBLIC.
* As the owner: sign in; `report_sales_summary` returns zeros; as a second, membership-less login: every RetailOS table returns 0 rows; Tirumala's app still signs in and loads (manual smoke by you).

**Rollback** (all new objects are ours, nothing is dropped from Tirumala or the 10 live tables): a generated `rollback.sql` that drops, by exact name, the 34 tables, 22 functions and policies in `retailos` (never `drop schema retailos`), drops `retailos_private` (`cascade`, it holds only our helpers), and restores the original `retailos` default privilege (`authenticated` SELECT on tables). Unexposing `retailos` in the dashboard is a one-click fallback. Because no Tirumala object is changed, Tirumala needs no rollback. Data loss risk is nil at this stage because every RetailOS table is empty.

**Decision on the 10 empty live tables:** keep them untouched through acceptance. After the MVP is accepted, with a fresh backup and a re-verified row count of 0, they can be retired. Preferred order: (1) rename to `retailos_legacy_*` and revoke `anon` on them, (2) after one quiet week drop them together with `public.retailos_has_role` and `public.retailos_can_access_branch`. Each step needs its own explicit approval. If they ever contain data, we stop and plan a data migration instead.

## 7. Remaining manual dashboard/account actions

1. Add `retailos` to **Settings → API → Exposed schemas** (after the migration; I will not do this without approval).
2. Decide on **public sign-ups** (currently on). Recommended off; invites then go through the server's admin key.
3. Set **Site URL** (currently `http://localhost:3000`) and redirect allow-list; configure email (SMTP) for invites.
4. **Rotate the service-role key** and **revoke the personal access token** that were pasted into chat.
5. Create the owner login in Authentication and tell me the email (not the password) for the bootstrap script.
6. Review and decide on the Tirumala fixes in `TIRUMALA_SECURITY_FIXES_PROPOSED.md`.
7. Provide production env values in Vercel (names in `.env.example`); never in chat.

## 8. Time estimate (active hours)

| Step | Hours |
|---|---|
| Move port + tests into the repo, reseal, run full local suite | 1.0–1.5 |
| App client schema option, env aliases, unit tests, docs | 1.0–1.5 |
| Rollback script + pre/post verification queries as a script | 1.0 |
| **Subtotal until the migration is ready for your approval** | **3–4** |
| Apply + validate on production (with you) | 1.0 |
| Browser pass, fixes, Playwright smoke | 4–5 |
| Deploy, one real test sale, handover | 1.5 |
| **Total to MVP** | **about 9.5–11.5 h**, plus waiting on dashboard steps |
