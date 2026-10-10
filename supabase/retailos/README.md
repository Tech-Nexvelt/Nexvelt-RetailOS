# `supabase/retailos` — the RetailOS database for its own DEDICATED Supabase project

**Status: NOT APPLIED to any hosted database.** Applying anything here needs explicit approval of the exact manifest. Read `docs/RETAILOS_NEW_PROJECT_CHECKLIST.md` first. The shared-project (Tirumala) phase is archived in `/archive/shared-project` and must not be used.

| Path | What it is |
|---|---|
| `migrations/` | The 14 tested migrations ported to schemas `retailos` and `retailos_private`. Generated from `../migrations` by `npm run retailos:port`, sealed in `SHA256SUMS`. |
| `bootstrap/first-tenant.sql` | One-time owner/tenant setup (placeholders must be edited). Run only after the migrations. |
| `rollback.sql` | Drops exactly the objects the migrations create. Never drops schema `retailos`, never touches `public`, `auth` or the 10 live `retailos_*` tables. |
| `verify/snapshot.sql` | Read-only hash queries to run before and after (compare). |
| `verify/post_checks.sql` | Read-only checks that must return zero rows after the migration. |

The sibling folder `../migrations` is the **original, preserved** design that targets schema `public`. **Do not apply it to the shared project**: it would revoke privileges on every Tirumala table and collides with Tirumala's `invoices`, `payments`, `products`, `categories` and `profiles`. It is kept only as the reference the port is generated from; `src/retailos-migrations.test.ts` checks both sets stay in step.

Rules this folder follows (enforced by tests):
* nothing is created in or changed on schema `public` or `auth`; no trigger on `auth.users`;
* no project-wide default-privilege change — only `alter default privileges in schema retailos`;
* no `grant/revoke ... on all tables in schema` anywhere except the private helper schema;
* no reference to the 10 existing `retailos_*` tables or Tirumala's `public.retailos_*` helper functions;
* every function is closed to `anon`/PUBLIC explicitly.

Run migrations as role `postgres` (the role that owns the existing `retailos` schema), in file order, each file inside `begin; … commit;`.
