# Archive: the shared-project (Tirumala) phase

**Not active. Nothing here runs in `npm test`, `npm run test:db`, lint, typecheck or the build.** `tsconfig.json`, `eslint.config.mjs` and both vitest configs exclude `archive/`.

Until 2026-10-10 the plan was to put RetailOS into an existing Supabase project that Tirumala Furniture also used. That plan was replaced by a **new, dedicated Supabase project for RetailOS only**. This folder keeps the material built for the shared phase, unchanged, so nothing is lost and the work can be reviewed or reused.

| File | What it was |
|---|---|
| `tests/db/prodlike.sql` | hand-made reconstruction of the other app's `public` schema and the 10 `retailos_*` tables that had been created in the old project |
| `tests/db/isolation.test.ts` | proved the migrations leave the other app untouched and that shared sign-in does not give shared access (16 tests) |
| `tests/db/live-clone-fidelity.test.ts` | proved a local clone matched the old project's catalog |
| `tests/db/harness.shared-project.ts`, `fixtures.shared-project.ts` | the test harness and fixtures as they were, including the `DB_BASE=live-clone` and fixture modes and the `insertFilled` helper |
| `scripts/clone-live-schema.mjs` | read-only extractor that copied the **old project's** schema into `.local/live-clone/` using a Management API token (never run again) |
| `scripts/test-db-clone.mjs` | ran the database suite against that clone |
| `supabase/retailos/verify/snapshot.sql`, `post_checks.sql` | before/after hash and post-check queries for the shared project |
| `supabase/retailos/rollback.shared-project.sql`, `MANIFEST.shared-project.sha256`, `README.shared-project.md` | the shared-project rollback (kept the 10 old tables), approval manifest and readme |

The shared-profile **migration files** are not copied here: they are in the local checkpoint commit `36ec305` (`git show 36ec305:supabase/retailos/migrations/<file>`).

These files are **not runnable as-is**: they import `./harness` and `./fixtures` from the active test folder, whose APIs changed. To revive them, copy them back next to the `*.shared-project.ts` versions of the harness and fixtures. They must never be pointed at the old project from this repository again.

The old project's own database and the Tirumala repository were never modified by this work.
