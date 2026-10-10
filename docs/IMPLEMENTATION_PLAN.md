# NexVelt RetailOS — Implementation Plan

| Field | Value |
|---|---|
| Document ID | NXR-PLAN |
| Version | 0.2 |
| Date | 2026-10-10 |
| Status | Draft. Live status is tracked in [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md). |
| Effort unit | Person-days (pd) for one senior full-stack engineer, including tests and documentation updates. Estimates are planning figures, not commitments. They exclude client review waiting time. |

## 1. Roadmap and critical path

```
P0 Docs ─▶ P1 Foundation ─▶ P2 Auth/Tenancy/RLS ─▶ P3 Catalogue+Ledger ─▶ P4 Barcode/Labels ─┐
                                                          │                                  │
                                                          └──────▶ P5 Pricing ───────────────┤
                                                                                              ▼
                              P6 Billing (checkout RPC, UI, receipts) ─▶ P7 Purchases/Returns/Audit ─▶ P8 Reports
                                                                                                         │
                                                                         P9 Integration, security, hardware, go-live ─▶ (P10 future)
```
**Critical path:** P2 → P3 → P6 → P7 → P9. P4 (labels) and P5 (pricing) run in parallel after P3, but **P5 is blocked by client answers OQ-01, OQ-02, OQ-05, OQ-08, OQ-10**. If those answers are late, launch with fixed-tag jewellery only and ship metal-rate pricing as a follow-up release.

## 2. Estimate summary

| Phase | Title | Estimate (pd) | Status (2026-10-10) |
|---|---|---:|---|
| 0 | PRD, TRD, architecture, specification | 5 | **In progress.** All ten documents drafted. Awaiting client review. |
| 1 | Project initialisation, standards, CI, design system | 6 | **Partial.** Project, lint, types, tests and design tokens exist. CI and several components outstanding. |
| 2 | Authentication, tenants, branches, roles, security | 14 | Not started (demo identity only) |
| 3 | Catalogue, variants, jewellery, inventory ledger | 17 | Not started |
| 4 | Barcodes, scanners, labels | 10 | Not started (exact-match rules implemented in the demo engine) |
| 5 | Jewellery pricing engine | 10 | Not started. Blocked on business answers. |
| 6 | Billing, invoices, payments, receipts | 18 | **Partial.** Rules proven on an in-memory demo engine. No database checkout, no UI. |
| 7 | Purchases, adjustments, returns, exchanges, audit | 16 | Not started |
| 8 | Reports, reconciliation, export | 10 | Not started |
| 9 | Integration, security validation, hardware, production | 12 | Not started |
| | **Subtotal** | **118** | |
| | Contingency (20%) | 24 | |
| | **Total to production** | **≈ 142 pd** | About 28 to 29 calendar weeks for one engineer, or about 15 to 16 weeks for two with good parallelism. |
| 10 | Future: transfers, payment gateway, offline billing | ≈ 40 to 60, estimated separately | Excluded from Release 1.0 |

## 3. Phases and tasks

**Priority:** P0 required for launch; P1 launch with a documented workaround if late; P2 desirable.
**Status:** `Done` (built **and** verified by the stated checks), `Partial`, `Todo`, `Blocked` (waiting on a decision).
**"Demo" means** the in-memory engine in `src/server/billing/`. It is not persistence and not production.

### Phase 0 — Documentation baseline (5 pd)

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T0.01 | PRD, TRD, database design | P0 | — | 2 | Done (draft) |
| T0.02 | API spec, security model, test strategy, acceptance criteria, runbook, assumptions, plan, traceability | P0 | T0.01 | 2 | Done (draft) |
| T0.03 | UX simplification plan | P0 | T0.01 | 0.5 | Done (draft) |
| T0.04 | Client review and sign-off of baseline | P0 | T0.01–03 | 0.5 + wait | **Todo** |

**Gate G0:** client approves the baseline or lists changes. Open questions with blocking phase ≤ 3 are answered.

### Phase 1 — Foundation (6 pd)

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T1.01 | Initialise Next.js 16 / React 19 / TypeScript 6 / Tailwind 4 with pinned versions and compatibility check | P0 | — | 0.5 | **Done** (typecheck, lint, test pass) |
| T1.02 | ESLint (flat), Prettier, strict TS, no-parseFloat money rule | P0 | T1.01 | 0.5 | **Done** |
| T1.03 | Vitest + Testing Library setup | P0 | T1.01 | 0.5 | **Done** (127 tests) |
| T1.04 | GitHub Actions CI: lint, typecheck, test, build, lockfile guard, secret scan | P0 | T1.01 | 1 | Todo |
| T1.05 | `.env.example`, Zod-validated `src/env.ts`, secret-prefix guard | P0 | T1.01 | 0.5 | Partial (`.env.example` only) |
| T1.06 | Design tokens and component kit (button, input/field, banner, states; then dialog, tabs, table, sheet, toast) | P0 | T1.01 | 2 | **Partial** (tokens + 5 components) |
| T1.07 | Git repository, branch and commit conventions, PR template | P0 | — | 0.5 | Partial (`git init` done, no commits, no remote) |
| T1.08 | Playwright setup and a smoke test | P1 | T1.04 | 0.5 | Todo |

**Gate G1:** CI green on a clean clone (`npm ci && npm run lint && npm run typecheck && npm test && npm run build`).

### Phase 2 — Auth, tenancy, security (14 pd)

Migrations M0001–M0004. Contracts API-AUTH-*, API-TEN-*.

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T2.01 | Provision isolated Supabase **dev** project; local Supabase CLI stack; migration workflow | P0 | T1.04 | 1 | **Blocked** (no credentials; Docker not running) |
| T2.02 | M0001–M0002: tenancy tables, permissions, system roles | P0 | T2.01 | 2 | Todo |
| T2.03 | M0003: helper functions and RLS for tenancy tables | P0 | T2.02 | 2 | Todo |
| T2.04 | M0004: audit log (append-only), rate-limit table | P0 | T2.02 | 1 | Todo |
| T2.05 | Supabase SSR sessions, `proxy.ts`, cookie flags, server guards (`requirePermission`, `requireBranch`) | P0 | T2.03 | 2 | Todo |
| T2.06 | Login, password reset, TOTP MFA enrolment, idle lock | P0 | T2.05 | 2 | Todo |
| T2.07 | Platform-admin console: create tenant, invite owner, suspend | P0 | T2.05 | 1 | Todo |
| T2.08 | **Negative authorisation suite** (pgTAP): cross-tenant, cross-branch, revoked, suspended, role escalation | P0 | T2.03 | 1 | Todo |
| T2.09 | Replace the demo identity cookie with real sessions; remove `switchDemoRole` | P0 | T2.06 | (in T2.05) | Todo |
| T2.10 | Settings workspace: shop profile, branches, counters, people (invite, disable, roles), tax/rounding/limit settings | P0 | T2.05 | 2 | Todo |

**Gate G2:** the negative suite is 100% green in CI against a real database; no browser bundle contains a secret.

### Phase 3 — Catalogue and inventory ledger (17 pd)

Migrations M0005, M0006, M0008. Contracts API-CAT-*, API-INV-*.

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T3.01 | M0005: categories, brands, sizes, colours, tax classes, products, variants, costs + RLS | P0 | G2 | 2 | Todo |
| T3.02 | M0006: metal types, purities, designs, jewellery items, stones, costs + RLS and guard triggers | P0 | T3.01 | 2 | Todo |
| T3.03 | M0008: movements ledger, balances, `apply_*` functions, adjustment tables + RLS | P0 | T3.01 | 2.5 | Todo |
| T3.04 | Products & Stock workspace shell, product list/search | P0 | T3.01 | 2 | Todo |
| T3.05 | Type-first product form: clothing | P0 | T3.04 | 1.5 | Todo |
| T3.06 | Variant matrix generator (size × colour) with SKU/barcode defaults | P0 | T3.05 | 1.5 | Todo |
| T3.07 | Imitation and precious item forms (conditional fields) | P0 | T3.04 | 2 | Todo |
| T3.08 | Stock enquiry and movement history | P0 | T3.03 | 1 | Todo |
| T3.09 | CSV import with dry-run (products, items, opening stock) | P0 | T3.03 | 2 | Todo |
| T3.10 | Ledger invariant tests (balance = Σ movements) | P0 | T3.03 | 0.5 | Todo |
| T3.11 | Product/design image upload (private bucket, 2 MB limit) | P2 | T3.04 | 1 | Todo |

**Gate G3:** every stock change passes through the ledger; RLS tests for catalogue and inventory green; imports are atomic.

### Phase 4 — Barcodes, scanning, labels (10 pd)

Migration M0007. Contract API-BAR-*.

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T4.01 | M0007: `barcode_aliases`, `document_sequences`, `resolve_barcode` (exact match only) | P0 | T3.02 | 1.5 | Todo (the exact-match rule is proven in the demo engine) |
| T4.02 | Barcode generation and SVG rendering (bwip-js) | P0 | T4.01 | 1 | Todo |
| T4.03 | Handheld scanner capture hook (burst detection, auto-focus) | P0 | T1.06 | 1.5 | Todo |
| T4.04 | Phone-camera scanner (BarcodeDetector + WASM fallback) | P0 | T4.03 | 2 | Todo |
| T4.05 | Label templates, preview, print, batch printing | P0 | T4.02 | 2.5 | Todo |
| T4.06 | **Hardware test** on NR Collections' label printer/scanner (50 labels, 100% first-read) | P0 | T4.05, OQ-14..17 | 1.5 | **Blocked** (hardware models unknown) |

**Gate G4:** TC-BAR-* pass; hardware acceptance TC-HW-01..04 signed.

### Phase 5 — Jewellery pricing (10 pd)

Migration M0009. Contract API-PRC-*. **Blocked by OQ-01, 02, 05, 08, 10.**

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T5.01 | M0009: metal rates (immutable), rules, versions, components | P0 | T3.02 | 2 | Blocked (design is complete) |
| T5.02 | `pricing.price_jewellery_item` and `tax.compute_line` | P0 | T5.01 | 3 | Blocked |
| T5.03 | Rule builder UI (draft → worked examples → activate) | P0 | T5.01 | 2 | Blocked |
| T5.04 | Rate entry screen and staleness checks | P0 | T5.01 | 1 | Blocked |
| T5.05 | Worked-example test fixtures supplied by the client | P0 | OQ-01 | 1 | Blocked |
| T5.06 | Tax configuration screens | P0 | OQ-09..11 | 1 | Blocked |

**Gate G5:** the client signs the worked examples, and the system reproduces every one to the paisa. Without this gate, metal-rate selling stays disabled.

### Phase 6 — Billing (18 pd)

Migration M0010. Contracts API-POS-*, API-PAY-*.

| ID | Task | Pri | Depends | pd | Status |
|---|---|---|---|---:|---|
| T6.01 | Demo billing engine: exact barcode, totals, discounts (default deny), split payments, idempotency, atomic commit | P0 | — | 3 | **Done at unit level** (127 tests incl. randomised invariants). **Not** database-proven. |
| T6.02 | M0010: cash sessions, idempotency keys, invoices, lines, snapshots, payments, document prints | P0 | G3 | 3 | Todo |
| T6.03 | `pos_checkout` RPC (locks, idempotency, server pricing, gapless numbers) | P0 | T6.02, T5.02 | 4 | Todo |
| T6.04 | Billing workspace UI (scan/search, cart, payment, complete, new bill) | P0 | T6.01, T1.06 | 3 | Todo |
| T6.05 | Receipt/invoice rendering and printing (thermal 80 mm, A4) | P0 | T6.03 | 2 | Todo |
| T6.06 | Day start/close, cash session RPCs | P0 | T6.02 | 1.5 | Todo |
| T6.07 | Discount approval tokens (manager approves on the counter) | P1 | T6.03, OQ-21 | 1 | Todo |
| T6.08 | **Concurrency tests** against PostgreSQL: duplicate checkout, same-item race, last-unit race | P0 | T6.03 | 0.5 | Todo |

**Gate G6:** database-backed checkout passes TC-CONC-*; the demo engine is no longer reachable in production configuration.

### Phase 7 — Purchases, adjustments, returns, exchanges, audit (16 pd)

Migration M0011. Contracts API-PUR-*, API-RET-*, API-INV-*.

| ID | Task | Pri | Depends | pd |
|---|---|---|---|---:|
| T7.01 | Suppliers and goods receipt (draft → post → cancel) with items and labels | P0 | G3 | 3 |
| T7.02 | Stock adjustments with approval | P0 | T3.03 | 2 |
| T7.03 | Sales workspace: bill list/detail, reprint | P0 | G6 | 2 |
| T7.04 | `pos_return` + credit notes, dispositions | P0 | G6, OQ-19/20 | 3.5 |
| T7.05 | `pos_exchange` | P0 | T7.04 | 2 |
| T7.06 | `pos_void_invoice`, `payment_method_correct` | P0 | G6, OQ-34 | 2 |
| T7.07 | Audit viewer (owner) | P0 | T2.04 | 1 |
| T7.08 | Customer record (optional) and masking | P1 | G6 | 0.5 + incl. |

All **Todo**. **Gate G7:** return/exchange/void idempotent and ledger-consistent; audit entries exist for every financial event.

### Phase 8 — Reports and reconciliation (10 pd)

Migration M0012. Contract API-RPT-*.

| ID | Task | Pri | Depends | pd |
|---|---|---|---|---:|
| T8.01 | Report views/functions (sales, payments, tax summary, stock, valuation, movements, jewellery register, returns, purchases, cash sessions) | P0 | G7 | 4 |
| T8.02 | Reports workspace (list + date range) | P0 | T8.01 | 2 |
| T8.03 | CSV export (streamed, audited) | P0 | T8.01 | 1.5 |
| T8.04 | Cash close report (Z-report) and variance sign-off | P0 | T6.06 | 1.5 |
| T8.05 | Report-to-ledger reconciliation tests (TC-RPT-01) | P0 | T8.01 | 1 |

All **Todo**.

### Phase 9 — Integration, security, hardware, go-live (12 pd)

| ID | Task | Pri | Depends | pd |
|---|---|---|---|---:|
| T9.01 | Full regression, UAT scripts UAT-01..12 with client staff | P0 | G8 | 3 |
| T9.02 | Security validation: RLS suite, dependency audit, header scan, secret scan, third-party review of auth flows | P0 | G8 | 2 |
| T9.03 | Performance tests against the NFR budgets (TC-PERF-*) | P0 | G8 | 1.5 |
| T9.04 | Accessibility checks (axe + manual keyboard pass) | P1 | G8 | 1 |
| T9.05 | Hardware acceptance on the store's devices | P0 | T4.06 | 1 |
| T9.06 | Production provisioning, backups, **restore drill** | P0 | G8 | 1.5 |
| T9.07 | Data migration (opening stock), cut-over rehearsal | P0 | OQ-30 | 1 |
| T9.08 | Training, user guide, handover | P0 | T9.01 | 1 |

**Gate G9 (release criteria):** see §5.

### Phase 10 — Future (not Release 1.0)

Branch transfers (FUT-01), payment-gateway integration (FUT-02), offline billing (FUT-03). These are **not** built, scheduled or promised for the initial release. Nothing in Phases 0 to 9 depends on them. The schema reserves names only (`TRANSFER_*` movement types).

## 4. Testing responsibilities

| Layer | Who writes | When | Tool |
|---|---|---|---|
| Unit (pure logic) | Feature developer | With the code | Vitest |
| Database (constraints, functions, RLS) | Feature developer, reviewed by a second person for security tables | With each migration | pgTAP |
| Integration / concurrency | Developer | Phase 6 onward | pgTAP + Node scripts against a real Postgres |
| E2E | Developer | Per workspace | Playwright |
| Security | Developer + independent review | Phase 2 and Phase 9 | pgTAP, ZAP baseline, `npm audit` |
| Hardware | Developer with client staff | Phase 4 and 9 | Manual scripts |
| UAT | Client | Phase 9 | Scripts UAT-01..12 |

Details in [TEST_STRATEGY.md](TEST_STRATEGY.md).

## 5. Release criteria for Release 1.0

1. All P0 acceptance criteria in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) pass on staging.
2. RLS negative suite and checkout concurrency suite pass against the staging database.
3. Zero open Severity-1 or Severity-2 defects.
4. Pricing worked examples signed (if metal-rate selling is included), invoice format and label layouts signed.
5. Backup restore drill completed and recorded.
6. Production configuration has **no** demo backend, demo identity or fixture data.
7. Hardware acceptance signed.
8. Runbook handed over; support terms agreed.

## 6. Risks and mitigations

See TRD §23 (R-01 to R-11). Additional planning risks:

| ID | Risk | Mitigation |
|---|---|---|
| R-12 | Client answers to OQ-01/02/05/08/10 arrive late | Ship fixed-tag jewellery first; metal-rate selling is a feature flag enabled after G5 |
| R-13 | No Supabase/Docker environment is available to the developer | Treat T2.01 as the first blocker. Migrations can be written before, but are **unverified** until run (see tracker) |
| R-14 | The in-memory demo engine is mistaken for production | Demo banner on every screen; engine is gated by `BILLING_BACKEND=demo`; Gate G6 requires its removal from production configuration |
