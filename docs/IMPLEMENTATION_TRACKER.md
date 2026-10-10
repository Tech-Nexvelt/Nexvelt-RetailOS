# NexVelt RetailOS — Implementation Tracker

Updated after each completed phase or increment. **It records only what was built and what was actually checked.** If a check has not been run, it says so.

| Last updated | 2026-10-10 |
|---|---|

## 1. Phase status

| Phase | Title | Status | Evidence / note |
|---|---|---|---|
| 0 | Documentation baseline | **Drafted, awaiting client review** | All ten required documents plus UX plan and traceability exist. Cross-document checker passes. Nothing is client-approved. |
| 1 | Foundation | **Partial** | Project, lint, types, tests, design tokens, 5 UI components: done. CI, env validation, Playwright, remaining components: not done. |
| 1a | Billing engine verification (unit level) | **Done (unit level only)** | 130 tests; 5 mutation checks; see §2 |
| 2 | Auth / tenancy / RLS | **Not started** (documentation complete; implementation begins next) | No Supabase project, no credentials, Docker daemon not running |
| 3–9 | Catalogue → go-live | Not started | |
| 10 | Future enhancements | Out of Release 1.0 | |

## 2. Verification log (actual results)

| Date | Command | Result |
|---|---|---|
| 2026-10-10 | `npx tsc --noEmit` | 0 errors |
| 2026-10-10 | `npx eslint .` | 0 errors, 0 warnings |
| 2026-10-10 | `npx vitest run` | 7 files, **130 tests passed** |
| 2026-10-10 | `npm run build` | Succeeded (Next.js 16.3.8, Turbopack) |
| 2026-10-10 | Clean-copy rehearsal: `npm ci` → lint → typecheck → test → build | All passed on a copy without `node_modules`/`.next` |
| 2026-10-10 | `npm audit --omit=dev` | 0 vulnerabilities in production dependencies |
| 2026-10-10 | `npm audit` (all) | 5 high, all in the dev-only ESLint glob chain (`braces` ← `micromatch` ← `fast-glob` ← `@next/eslint-plugin-next` ← `eslint-config-next`). Not shipped. `npm audit fix --force` would **downgrade** to `eslint-config-next@14`, so it was not applied. Re-check when `eslint-config-next` updates. |
| 2026-10-10 | Mutation checks on `engine.ts` | 5 deliberate faults each caught (3, 13, 7, 6, 3 failing tests); file restored |
| 2026-10-10 | Cross-document consistency checker | No problems: requirement, task, test, OQ, decision, API, migration, acceptance IDs all resolve; every one of 139 requirements has ≥ 1 criterion |
| — | PostgreSQL / RLS / concurrency tests | **Never run** (no database available) |
| — | Supabase, Vercel, hardware, browser/UI | **Never run** |

## 3. Capability status

| Capability | State |
|---|---|
| Money in integer paise, parsing, formatting | **Complete at unit level** |
| Exact barcode matching (no partial) | **Mocked**: demo engine, unit-verified |
| Duplicate-sale prevention, idempotency, atomic commit, payment reconciliation | **Mocked**: demo engine, unit-verified. **Not proven** against PostgreSQL or under real concurrency |
| Discount authority (default deny; owner unrestricted) | **Mocked**: engine + action layer, unit-verified. Limits for managers/cashiers **awaiting OQ-21** |
| Server-side authorisation of billing actions | **Mocked**: role comes from a demo cookie (no real authentication) |
| Fail-closed backend (no fake-data fallback) | **Implemented**, unit-verified |
| Five-item role-based navigation rules | **Implemented as logic + shell components**; no pages yet |
| Billing interface | **Not built** |
| Authentication, tenants, branches, memberships | **Not built** |
| Database schema, migrations, RLS | **Designed only** |
| Tax calculation | **Awaiting approval** (OQ-09, 10, 11). Not computed; `taxConfigured:false` |
| Jewellery metal-rate pricing | **Awaiting approval** (OQ-01, 02, 05, 08). Fixed-tag pricing only |
| Printing, labels, scanners, camera | **Not built** |
| Returns, exchanges, voids, purchases, reports, audit viewer | **Not built** |

## 4. Known defects, risks and limitations

| ID | Item | Severity | Note |
|---|---|---|---|
| K-01 | Demo identity is a cookie; there is no authentication | Critical if exposed | Demo must never be reachable by real users. Replaced in T2.09. |
| K-02 | Demo state is in process memory and lost on restart | Info | By design |
| K-03 | Security headers are configured but not verified against a running server | Low | Verify in Phase 1/9 |
| K-04 | No CI pipeline | Medium | T1.04 |
| K-05 | Package audit: 5 dev-tooling findings (see §2) | Low | Not in production bundle |
| K-06 | Idempotency in the demo engine is not bound to the actor | Medium | Production design stores the actor with the key (DB §12.5) |
| K-07 | `tsconfig.json` was auto-modified by Next.js on first build (added `.next/dev/types/**/*.ts`) | Info | Accepted |

## 5. Blockers

| Blocker | Needed from | Unblocks |
|---|---|---|
| Supabase **development** project URL, publishable key and secret key (never the production database) | Project owner | Auth, migrations applied, RLS and integration tests |
| Running Docker daemon (or a Supabase project) | Developer machine | Local Supabase stack, pgTAP, concurrency tests |
| Answers to OQ-01, 02, 05, 08, 10 | NR Collections | Metal-rate pricing |
| Answers to OQ-09, 11, 12 | NR Collections | Tax and invoice format |
| Answer to OQ-21 | NR Collections | Manager/cashier discount limits |
| Printer, scanner and label sizes (OQ-14..17) | NR Collections | Hardware acceptance |

## 6. Next milestone

**Phase 2 / Part B:** Supabase foundation. Version-controlled migrations (tenancy, memberships, roles/permissions, catalogue, serialized jewellery, stock, ledger, sales, payments, audit), RLS with a negative-test suite, authentication, and a database-backed transactional checkout RPC. Anything that needs a database that is not available will be written and clearly marked **unexecuted**.
