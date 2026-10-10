# NexVelt RetailOS — Test Strategy

| Field | Value |
|---|---|
| Document ID | NXR-TEST |
| Version | 0.2 |
| Date | 2026-10-10 |
| Related | [Acceptance Criteria](ACCEPTANCE_CRITERIA.md) · [Security Model](SECURITY_MODEL.md) · [Implementation Plan](IMPLEMENTATION_PLAN.md) |

## 1. Principles
1. **Unit tests prove application rules. They do not prove database behaviour.** The in-memory demo engine is single-threaded: "two cashiers at once" there is only a sequential simulation. Locking, isolation, rollback, unique-index backstops and RLS are proven **only** by tests that run against a real PostgreSQL. Those tests are listed here as *planned*; none has been run yet.
2. **A test that cannot fail is worthless.** Critical rules are mutation-checked: temporarily break the rule and confirm the suite fails (done for the engine, §3).
3. **Tests state their scope.** Each file header says which layer it proves and which it does not.
4. **No skipped or silenced failures.** `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` must all pass. Type errors are fixed, not suppressed.
5. **Financial paths never use placeholder success.** UI tests must fail if a "paid"/"saved" state appears before the backend confirms.

## 2. Test layers

| Layer | Scope | Tool | Runs | Status |
|---|---|---|---|---|
| **Unit** | Pure domain logic: money, barcode normalisation, error map, navigation, policy | Vitest | every commit | **Running, passing** |
| **Engine unit** | Demo billing engine rules | Vitest | every commit | **Running, passing** |
| **Action-layer unit** | Server actions with doubled `next/headers` and `server-only`: authorisation, strict schemas, role policy, fail-closed backend | Vitest | every commit | **Running, passing** |
| **Component / UI** | Billing workspace states, keyboard flow, error display, double-submit protection | Vitest + Testing Library | every commit | Planned (UI not built) |
| **Database** | Constraints, triggers, functions, immutability, ledger invariants | pgTAP via `supabase test db` | every PR | Planned (no database yet) |
| **RLS / security** | Negative authorisation suite TC-SEC-01..20 | pgTAP | every PR | Planned |
| **Integration / concurrency** | Real transactions: duplicate checkout, same-item race, last-unit race, deadlock ordering, rollback | Node scripts / pgTAP with parallel connections | every PR (Phase 6+) | Planned |
| **API / contract** | Server actions against a real database with real auth sessions | Vitest + Supabase local stack | every PR | Planned |
| **End-to-end** | Browser flows | Playwright | nightly + release | Planned |
| **Accessibility** | axe on core screens + manual keyboard pass | Playwright + axe | release | Planned |
| **Performance** | NFR-02 budgets | k6 or a Node script against staging | release | Planned |
| **Hardware** | Scanner, camera, label printer, receipt printer, cash drawer | Manual scripts | Phase 4 and 9 | Planned (models unknown) |
| **UAT** | Client staff on their devices | Scripts UAT-01..12 | Phase 9 | Planned |

## 3. Current automated results (verified 2026-10-10)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint .` | 0 errors, 0 warnings |
| `npx vitest run` | 7 files, **130 tests, all passing** |
| Production build | **Not yet run** (see tracker) |
| Mutation checks on `engine.ts` | 5 deliberate faults (prefix barcode match; discount limit ignored; idempotency replay off; serialized item not marked sold; unconfirmed UPI accepted) were each caught by 3 to 13 failing tests; the file was restored and the suite returned to green |

Test files: `src/domain/domain.test.ts`, `money.test.ts`; `src/server/billing/engine.test.ts`, `engine.rules.test.ts`, `engine.discount.test.ts`, `engine.audit.test.ts`, `actions.test.ts`.

## 4. Mandatory test cases

IDs are stable and referenced from the acceptance criteria. `Auto` = currently automated and passing; `Planned` = specified, not yet implemented. **"Layer"** states what it can actually prove.

### 4.1 Cross-tenant and branch isolation
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-SEC-01..20 | See [Security Model §6.1](SECURITY_MODEL.md) | pgTAP (database) | Planned |
| TC-SEC-21 | Server action refuses every billing action without `sale.create` | Action unit | **Auto** (`actions.test.ts`) |
| TC-SEC-22 | Tampered/unknown role cookie resolves to least privilege | Action unit | **Auto** |
| TC-SEC-23 | Client-supplied price/total/extra fields are rejected | Action unit | **Auto** |
| TC-SEC-24 | Unconfigured backend refuses to run; no fake-data fallback | Action unit | **Auto** |

### 4.2 Barcode and scanning
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-BAR-01 | Exact code adds item immediately; case/whitespace normalised | Engine unit | **Auto** |
| TC-BAR-02 | **No partial match**: prefixes, substrings, near codes, embedded spaces, look-alike characters all return not found | Engine unit | **Auto** |
| TC-BAR-03 | Name search never returns results from barcodes/tag codes | Engine unit | **Auto** |
| TC-BAR-04 | Unknown, inactive, sold, held, other-branch, out-of-stock give distinct errors | Engine unit | **Auto** |
| TC-BAR-05 | `resolve_barcode` uniqueness across variants and items per tenant | pgTAP | Planned |
| TC-BAR-06 | Scanner burst detection (speed, length, terminator) | Unit + browser | Unit helper **Auto**; browser Planned |
| TC-BAR-07 | Scanner failure: no input, wrong layout, partial read → manual entry still works | UI / hardware | Planned |
| TC-BAR-08 | Camera: permission denied, no camera, unsupported browser → clear message + manual entry | UI | Planned |

### 4.3 Pricing, discounts and totals
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-PRC-01 | Integer paise arithmetic; no float drift; invalid amounts rejected | Unit | **Auto** |
| TC-PRC-02 | Server prices from catalogue only; client price ignored/rejected | Engine + action unit | **Auto** |
| TC-PRC-03 | Totals, discount totals and line totals reconcile exactly | Engine unit + randomised invariants | **Auto** |
| TC-PRC-04 | Discount default deny; owner allowed; limits exact at boundary (limit, limit+1 paisa) | Engine unit | **Auto** |
| TC-PRC-05 | Discount > line, negative, fractional, NaN, huge → rejected; no negative totals | Engine unit | **Auto** |
| TC-PRC-06 | Zero-value bill refused | Engine unit | **Auto** |
| TC-PRC-07 | Metal-rate pricing reproduces the client's signed worked examples to the paisa | pgTAP / unit | Planned (blocked OQ-01) |
| TC-PRC-08 | Tax computation: slabs, inclusive/exclusive, CGST/SGST/IGST, round-off | pgTAP / unit | Planned (blocked OQ-09..11) |
| TC-PRC-09 | `PRICE_STALE` when a rate/rule/price changes between quote and checkout | pgTAP integration | Planned |
| TC-PRC-10 | Rate effective-dating and staleness block | pgTAP | Planned |

### 4.4 Checkout, duplicates, payments
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-CHK-01 | Mixed cart completes; stock decremented; unique items marked sold | Engine unit | **Auto** |
| TC-CHK-02 | **Duplicate checkout request** (double click / retry): one invoice, one stock decrement, `replayed: true` | Engine unit | **Auto** |
| TC-CHK-03 | Same key with different payload (cart, payment or discount) → `IDEMPOTENCY_KEY_REUSED` | Engine unit | **Auto** |
| TC-CHK-04 | Failed attempt stores nothing; the same key may be retried | Engine unit | **Auto** |
| TC-CHK-05 | **All-or-nothing**: every failure path leaves stock, statuses and invoices untouched | Engine unit + 2,000 randomised operations | **Auto** |
| TC-CHK-06 | Gapless invoice numbers across failures | Engine unit | **Auto** |
| TC-CHK-07 | **Incorrect stock updates**: stock = initial − units sold, never negative, unique items sold at most once | Randomised invariants | **Auto** |
| TC-CHK-08 | Day not started → no sale | Engine unit | **Auto** |
| TC-CHK-09 | Real transaction rollback on a mid-way failure (forced error inside the RPC) | pgTAP | Planned |
| TC-CHK-10 | Gapless numbering under concurrent checkouts | Concurrency | Planned |

### 4.5 Concurrency (database only)
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-CONC-01 | **Two sessions sell the same jewellery item at the same instant**: exactly one invoice; the other gets `ITEM_ALREADY_SOLD` | Postgres, parallel connections | **Planned. Not proven.** The unit test only simulates this sequentially. |
| TC-CONC-02 | Two sessions sell the last unit of a variant: one succeeds | Postgres | Planned |
| TC-CONC-03 | Same idempotency key sent concurrently ×10: one invoice | Postgres | Planned |
| TC-CONC-04 | Opposing lock orders do not deadlock (cart order permuted) | Postgres | Planned |
| TC-CONC-05 | Partial unique index on `invoice_items(jewellery_item_id)` blocks double sale even if the lock logic is bypassed | pgTAP | Planned |
| TC-CONC-06 | Void racing with return on the same invoice | Postgres | Planned |
| TC-CONC-07 | Rate change racing with checkout | Postgres | Planned |

### 4.6 Payments
| ID | Case | Layer | Status |
|---|---|---|---|
| TC-PAY-01 | Σ payments = total exactly; under/over rejected; no payment rejected | Engine unit | **Auto** |
| TC-PAY-02 | Split payments (including three-way); change only from cash | Engine unit | **Auto** |
| TC-PAY-03 | **Failed/declined/unconfirmed UPI or card is never recorded as received**; no invoice created | Engine unit | **Auto** |
| TC-PAY-04 | Unknown payment method rejected even if "confirmed" | Engine unit | **Auto** |
| TC-PAY-05 | Cash tendered below amount rejected | Engine unit | **Auto** |
| TC-PAY-06 | UI shows success only after the server confirms; shows "checking" on network loss; retries with the same key | Component | Planned |
| TC-PAY-07 | Payment correction reverses and re-records; audited | pgTAP | Planned |

### 4.7 Inventory, purchases, returns
| ID | Case | Status |
|---|---|---|
| TC-INV-01 | Ledger invariant: balance = Σ movements per branch/variant/bucket | Planned |
| TC-INV-02 | Opening import atomic; failed row rolls back all | Planned |
| TC-INV-03 | Goods receipt post/cancel atomic; cannot cancel consumed stock | Planned |
| TC-INV-04 | Adjustment approval workflow; cannot go negative | Planned |
| TC-RET-01 | Partial returns cap at sold − returned; credit-note numbering gapless | Planned |
| TC-RET-02 | Exchange atomic; net settlement correct | Planned |
| TC-RET-03 | Void restricted to same day/open session; reverses stock and payments | Planned |
| TC-RET-04 | Disposition RESTOCK / QC_HOLD / DAMAGED routes stock to the right bucket | Planned |

### 4.8 Reports and reconciliation
| ID | Case | Status |
|---|---|---|
| TC-RPT-01 | Every report total equals the sum of its underlying invoices/payments/movements | Planned |
| TC-RPT-02 | Branch-scoped users see only their branch in every report | Planned |
| TC-RPT-03 | CSV export escapes formula characters; is audited | Planned |
| TC-RPT-04 | Cash session expected/variance computation | Planned |

### 4.9 Printing and hardware (manual, on the client's devices)
| ID | Case | Pass criterion | Status |
|---|---|---|---|
| TC-HW-01 | Handheld scanner (USB and Bluetooth) | 100% of 100 scans of mixed codes land correctly with no stray characters | Planned (OQ-17) |
| TC-HW-02 | Phone camera scan | ≥ 95% first-read rate over 50 labels in store lighting | Planned |
| TC-HW-03 | Receipt print | Receipt matches approved layout; width not cut; cut/feed correct | Planned (OQ-16) |
| TC-HW-04 | Label print | 50 labels at true size, 100% scannable with the store's scanner, within agreed tolerance | Planned (OQ-15/16) |
| TC-HW-05 | **Printer failure** (off, out of paper, disconnected): invoice stays saved; clear "saved, print failed"; reprint works | Planned |
| TC-HW-06 | **Scanner failure** (battery/disconnect): cashier can continue by search/manual entry; no wrong item added | Planned |
| TC-HW-07 | Cash drawer opens with the receipt (if supported) | Planned |

### 4.10 Non-functional
| ID | Case | Budget |
|---|---|---|
| TC-PERF-01 | `resolve_barcode` server p95 | ≤ 300 ms |
| TC-PERF-02 | Scan → line rendered p95 | ≤ 700 ms |
| TC-PERF-03 | `pos_checkout` p95 (≤ 30 lines) | ≤ 2 s |
| TC-PERF-04 | Product search p95 (100k variants) | ≤ 1 s |
| TC-PERF-05 | 12-month branch report p95 | ≤ 5 s |
| TC-PERF-06 | POS LCP on counter PC | ≤ 2.5 s |
| TC-A11Y-01 | axe: 0 critical/serious on sign-in, billing, payment, returns, labels | |
| TC-A11Y-02 | Full keyboard billing without a mouse; visible focus; announcements | |
| TC-RESP-01 | Billing usable at 360, 768 and 1366 px widths | |

All Planned.

### 4.11 Additional cases (feature coverage)
All **Planned** unless noted. Each is referenced by an acceptance criterion in section J of [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

| ID | Case |
|---|---|
| TC-SET-01 | Tenant profile, branch and counter create/edit/deactivate; profile text appears on the invoice header; a deactivated branch cannot bill |
| TC-SET-02 | Tenant settings (inclusivity, rounding, return window, limits, thresholds) save, are audited, and unset values block the dependent feature instead of defaulting |
| TC-USR-01 | Invite, accept, disable a user; password reset by email link; reset does not reveal whether an account exists; idle lock re-authenticates |
| TC-USR-02 | Each staff member has an individual login; audit rows show the individual actor |
| TC-CAT-01 | Categories (two levels, kind-consistent), brands (case-insensitive unique), referenced records can only be deactivated, never deleted |
| TC-CAT-02 | Catalogue search returns results by name/SKU/style/design within 1 s at 100,000 variants and never by partial barcode |
| TC-CAT-03 | Image upload accepts JPEG/PNG/WebP up to 2 MB and rejects other types and sizes; objects are tenant-scoped |
| TC-CLO-01 | Variant price, cost, tax class and stock per branch are stored; tag print quantity per variant |
| TC-IMJ-01 | Creating N imitation items from one design yields N unique tags and barcodes with a common price, each editable before sale |
| TC-PMJ-01 | A precious item supports both pricing modes; fixed price is always available regardless of rule configuration; history timeline lists receipt, edits, prints, sale, return |
| TC-PRC-11 | Rule components render a printed breakdown; rounding follows tenant configuration; component totals equal the line price |
| TC-LBL-01 | Every label batch is logged with user, time, items and quantities |
| TC-POS-01 | Billing requires an open session; customer details optional unless a threshold applies; the cart draft survives a refresh; billing is completable by keyboard |
| TC-PAY-08 | Payment references (UPI/card) captured per configuration; cash-limit threshold warns or blocks per configuration; no value is hard-coded |
| TC-INV-05 | A4 layout renders; receipt carries a scannable invoice QR code that finds the invoice |
| TC-PUR-01 | Supplier master; receipt captures supplier invoice and costs; cancel rules; label printing is offered after posting |
| TC-STK-01 | Opening stock appears as `OPENING` movements; stock enquiry shows balances and history; low-stock list uses the reorder level |
| TC-RPT-05 | Dashboard numbers, metal-rate history and UPI/card settlement lists reconcile with the ledger |
| TC-AUD-01 | Audit retention setting is applied and no row can be altered; owners can filter by date, user, action, entity |
| TC-OPS-01 | Uptime monitor and alert fire on a simulated outage; availability reported monthly |
| TC-OPS-02 | Supported browser/device matrix (Chrome/Edge Windows; Chrome Android; Safari iOS 17+) passes the billing smoke script |
| TC-OPS-03 | Coverage gates: ≥ 90% line coverage on pricing, tax, checkout, return and inventory modules; ≥ 70% overall |
| TC-OPS-04 | Alerts and correlated error reports exist for checkout failures; no personal data appears in logs or error reports |
| TC-OPS-05 | Database and storage are in the agreed India region |
| TC-OPS-06 | Load test at the launch sizing (100,000 variants, 50,000 items, 2,000 invoices/day) meets TC-PERF budgets |
| TC-I18N-01 | Currency uses Indian digit grouping (**Auto**, `money.test.ts`); dates are DD-MM-YYYY in the branch time zone (Planned) |
| TC-PRIV-01 | Customer phone masked for roles without `customer.view`; anonymisation keeps invoice snapshots; no PII in logs |

## 5. User acceptance tests (UAT)
Executed by NR Collections staff on their hardware, on staging, with their sample data. A script passes only when every step's expected result is observed and recorded.

| ID | Script |
|---|---|
| UAT-01 | Owner sets up shop profile, branch, counter, users |
| UAT-02 | Manager creates clothing product with size/colour variants; prints labels |
| UAT-03 | Manager adds imitation and precious jewellery items; prints tags |
| UAT-04 | Owner enters metal rates and activates a rule; checks the worked examples |
| UAT-05 | Cashier starts the day and sells a mixed cart with cash |
| UAT-06 | Cashier sells with split UPI + cash; with card |
| UAT-07 | Handheld scanner and phone-camera scan |
| UAT-08 | Return and exchange with manager approval |
| UAT-09 | Same-day void; reprint |
| UAT-10 | Goods receipt and stock adjustment |
| UAT-11 | Day close with a deliberate variance; Z-report |
| UAT-12 | Owner reviews reports and exports CSV |

## 6. Environments and data
- Unit tests: no external services.
- Database/integration tests: Supabase CLI local stack (Docker) and CI service. **Not available in the current development environment** (Docker daemon not running; no Supabase project). Until then these tests are written but unexecuted, and reports must say so.
- Test data: fictitious fixtures only (`demo-data.ts` and pgTAP fixtures). No real customer data in tests. Production data is never used.

## 7. Exit criteria per phase
A phase may be reported complete only when its automated tests pass **in the environment that proves the claim** (database claims need a database), lint and typecheck are clean, the build succeeds, the tracker is updated, and known defects are listed.

## 8. Defect handling
| Severity | Example | Rule |
|---|---|---|
| S1 | Wrong money, double sale, data leak, billing down | Blocks release; fix + regression test first |
| S2 | Major function broken, workaround exists | Blocks release unless the client accepts in writing |
| S3 | Minor defect | Fix in order; may ship |
| S4 | Cosmetic / request | Backlog |

Every S1/S2 fix adds a regression test before the fix is merged.
