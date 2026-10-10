# NexVelt RetailOS — Acceptance Criteria

| Field | Value |
|---|---|
| Document ID | NXR-AC |
| Version | 0.2 |
| Date | 2026-10-10 |
| Related | [PRD](PRD.md) · [Implementation Plan](IMPLEMENTATION_PLAN.md) · [Test Strategy](TEST_STRATEGY.md) · [Traceability](TRACEABILITY.md) |

Each criterion is **measurable** and **pass/fail**. It links to a requirement (PRD), an implementation task (Plan) and a test case (Test Strategy).

**Status key (as of 2026-10-10):**
- `UNIT ✔` = the **application rule** is implemented and passes automated unit tests (demo engine/actions). The criterion is **not** satisfied for production until the database-backed implementation passes too.
- `—` = not built / not verified.
- `BLOCKED` = needs a client decision first (OQ id).

A criterion is **Accepted** only when every layer it names has passed. Today **no criterion is Accepted**: the work so far proves unit-level rules only.

---

## A. Platform, tenants, users, security

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-PLT-01 | FR-PLT-01 Create tenant | A platform admin (aal2) creates a tenant and an owner invitation is sent; a non-admin gets `FORBIDDEN` | T2.07 | TC-SEC-12, UAT-01 | — |
| AC-PLT-02 | FR-PLT-02 Suspend tenant | After suspension, every read and write by that tenant's users is denied within one request; data intact | T2.07 | TC-SEC-07 | — |
| AC-PLT-03 | FR-PLT-03 No default admin access | A platform admin without a grant reads **0 rows** from all business tables; with a valid grant reads only, until expiry; every access audited | T2.03 | TC-SEC-12..14 | — |
| AC-TEN-01 | FR-TEN-02/03 Branches and counters | Owner creates, edits and deactivates branches/counters; a deactivated branch cannot bill | T2.05 | UAT-01 | — |
| AC-TEN-02 | FR-TEN-05 Branch scope | A user with two branch memberships sees only data of the active branch; the server rejects a forged branch id | T2.05 | TC-SEC-04, 05, 17 | — |
| AC-USR-01 | FR-USR-01/02 Users and revocation | A disabled membership is refused on the next request (≤ 1 request lag) | T2.05 | TC-SEC-06 | — |
| AC-USR-02 | FR-USR-04 MFA | Owner and platform-admin accounts cannot perform aal2 actions without TOTP | T2.06 | TC-SEC-15 | — |
| AC-SEC-01 | NFR-01 Isolation | The negative suite TC-SEC-01..20 passes at **100%** against a real database | T2.08 | TC-SEC-01..20 | — |
| AC-SEC-02 | Server-side authorisation | Every billing server action returns `FORBIDDEN` without `sale.create`; unknown/tampered role resolves to least privilege | T6.03 | TC-SEC-21, 22 | UNIT ✔ |
| AC-SEC-03 | No client trust | A checkout containing a client-supplied price, total, tax or any unknown field is rejected; the total used is recomputed on the server | T6.03 | TC-SEC-23, TC-PRC-02 | UNIT ✔ |
| AC-SEC-04 | No secret in browser | A search of the built client bundle finds no server secret; CI fails if a secret has a `NEXT_PUBLIC_` prefix | T1.05 | CI check | — |
| AC-SEC-05 | Fail closed | With `BILLING_BACKEND` unset or ≠ `demo`, every billing action returns `INTERNAL` and no in-memory engine is created. Production configuration contains no demo backend. | T6.03 / G6 | TC-SEC-24 | UNIT ✔ (action layer). Production removal: — |
| AC-AUD-01 | FR-AUD-01/02 Audit | Each event type listed in Security Model §10 creates exactly one audit row; UPDATE/DELETE on audit rows fails for every role including service credentials | T2.04 | TC-SEC-10 | — |

## B. Catalogue and stock

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-CLO-01 | FR-CLO-01..03 Variants | Creating a style with 3 sizes × 2 colours yields 6 variants with unique SKUs and unique barcodes; duplicate size/colour is rejected | T3.05, T3.06 | UAT-02 | — |
| AC-CLO-02 | FR-CAT type-first form | Choosing a product type shows only that type's fields (clothing: style, brand, category, size, colour, price, variants; imitation: tag, barcode, price, stock; precious: pricing mode and only the applicable fields). Hidden fields are filled by defaults, not dropped. | T3.05, T3.07 | UI test, UAT-02/03 | — |
| AC-IMJ-01 | FR-IMJ-02/04 Items | Each imitation piece has a unique tag/barcode; a non-`IN_STOCK` piece cannot be sold | T3.07 | TC-INV-01 | UNIT ✔ (sale refusal in demo engine) |
| AC-PMJ-01 | FR-PMJ-01/03 Precious item | Net weight > 0 and ≤ gross weight; metal and purity required; weights stored with 3 decimals | T3.07 | pgTAP constraints | — |
| AC-PMJ-02 | FR-PMJ-04 Edit lock | After sale, price-affecting fields cannot be edited (database rejects) | T3.02 | pgTAP | — |
| AC-STK-01 | FR-STK-01 Ledger | For every branch/variant/bucket, `on_hand` = Σ movement deltas after any sequence of operations | T3.03, T3.10 | TC-INV-01 | Rule modelled in demo (stock conservation) UNIT ✔; ledger — |
| AC-STK-02 | FR-STK-05 Negative stock | Stock cannot go below zero (default); attempting to sell more than available returns `INSUFFICIENT_STOCK` and changes nothing | T3.03 | TC-CHK-07, TC-CONC-02 | UNIT ✔ (demo); DB — |
| AC-STK-03 | FR-STK-03 Adjustments | A decrease needs a reason; an unapproved adjustment does not change stock | T7.02 | TC-INV-04 | — |
| AC-IMP-01 | FR-CAT-04 Import | A file with one invalid row among 100 applies **no** rows and returns a row-level error report | T3.09 | TC-INV-02 | — |

## C. Barcodes, scanning and labels

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-BAR-01 | FR-BAR-01/02 Exact match | A scanned code adds its item immediately; codes are unique per tenant; no prefix, substring or fuzzy match ever resolves a barcode (0 false matches in the 6+ near-miss cases tested) | T4.01 | TC-BAR-01..03, 05 | UNIT ✔ (demo); DB uniqueness — |
| AC-BAR-02 | FR-BAR-03 Handheld scanner | 100 of 100 scans from the store's scanner land in the scan field, with no stray characters, from any billing state | T4.03 | TC-HW-01 | — |
| AC-BAR-03 | FR-BAR-04/05 Camera + fallback | Camera scanning reads ≥ 95% of 50 labels on Chrome Android and Safari iOS 17+; on denial or no camera the user sees a plain-language message and can type the code | T4.04 | TC-HW-02, TC-BAR-08 | — |
| AC-BAR-04 | FR-BAR-06 Feedback | Each outcome (added, unknown, sold, held, other-branch, no stock, already in cart) shows a distinct plain-language message | T6.04 | TC-BAR-04 | UNIT ✔ (messages); UI — |
| AC-LBL-01 | FR-LBL-01..03 Labels | 50 test labels print at the agreed size (±0.5 mm) and 100% scan with the store's scanner | T4.05, T4.06 | TC-HW-04 | BLOCKED OQ-14..17 |
| AC-LBL-02 | FR-LBL-05 Metal-rate labels | A metal-rate label prints weights/purity but no calculated price (unless OQ-15 changes this) | T4.05 | UI test | BLOCKED OQ-15 |

## D. Pricing and tax

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-PRC-01 | FR-PRC-07 Worked examples | The system reproduces **every** client-signed worked example (≥ 5) to the paisa before metal-rate selling is enabled | T5.05 | TC-PRC-07 | BLOCKED OQ-01 |
| AC-PRC-02 | FR-PRC-01 Rates immutable | A rate row cannot be updated or deleted; a correction is a new row; each sale references the rate id | T5.01 | pgTAP | BLOCKED OQ-02, 05 |
| AC-PRC-03 | FR-PRC-04 Snapshots | Changing a rate or rule after a sale leaves the old invoice line unchanged | T5.02, T6.03 | TC-PRC-09 | — |
| AC-PRC-04 | FR-PRC-05 Stale price | A checkout whose basis changed returns `PRICE_STALE` with a fresh quote and creates no invoice | T6.03 | TC-PRC-09 | UNIT ✔ (total mismatch in demo); DB basis — |
| AC-PRC-05 | FR-PRC-06 No rate, no sale | A metal-rate item without an effective rate cannot be sold | T5.04 | TC-PRC-10 | BLOCKED OQ-02 |
| AC-PRC-06 | No hard-coded formula | A code search finds no jewellery pricing constant or formula; pricing is data driven | T5.02 | Code review | — |
| AC-TAX-01 | Tax correctness | For each tax class, slab and inclusive/exclusive case supplied by the client's accountant, computed tax matches to the paisa; an item with no configured tax cannot be billed | T5.06 | TC-PRC-08 | BLOCKED OQ-09..11 |
| AC-MON-01 | NFR-14 Integer money | No money value is handled as a float: arithmetic in integer paise; invalid, negative, fractional amounts are rejected; lint forbids `parseFloat` | T1.02 | TC-PRC-01 | UNIT ✔ |

## E. Billing

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-POS-01 | FR-POS-02/03 Unified cart | One cart holds clothing, imitation and precious items; repeat scan of clothing +1; repeat scan of a jewellery tag is rejected | T6.04 | TC-CHK-01, TC-BAR-04 | UNIT ✔ (engine); UI — |
| AC-POS-02 | FR-POS-06 Server totals | Grand total shown = server total in 100% of tested carts; the client cannot alter it | T6.03 | TC-PRC-02, 03 | UNIT ✔ |
| AC-POS-03 | FR-POS-07 Atomic checkout | If any step fails, **no** invoice, payment, stock change or number is consumed (tested at every failure point incl. forced mid-transaction error) | T6.03 | TC-CHK-05, 09 | UNIT ✔ (demo, 2,000 random ops); DB rollback — |
| AC-POS-04 | FR-POS-08 Duplicate submit | 10 identical concurrent or repeated submissions with one key create exactly **one** invoice and one stock decrement | T6.03, T6.08 | TC-CHK-02, TC-CONC-03 | UNIT ✔ (sequential); concurrent DB — |
| AC-POS-05 | Same key, other payload | Rejected with `IDEMPOTENCY_KEY_REUSED`; nothing created | T6.03 | TC-CHK-03 | UNIT ✔ |
| AC-POS-06 | Double sale of a jewellery item | Two sessions selling one piece at the same time yield **one** invoice; the other fails with `ITEM_ALREADY_SOLD` | T6.03, T6.08 | TC-CONC-01, 05 | UNIT ✔ (sequential only); **concurrent DB — NOT PROVEN** |
| AC-POS-07 | FR-POS-09 Invoice numbers | Numbers are consecutive per branch per financial year with no gaps, including after failed attempts and under concurrency | T6.03 | TC-CHK-06, 10 | UNIT ✔ (sequential); DB — |
| AC-POS-08 | FR-POS-04, FR-POS-13 Discounts and positive total | A user without authority cannot apply any discount (checked in the engine, not just the UI); discount ≤ line, within limit exactly, reason required; bill total > 0 | T6.03, T6.07 | TC-PRC-04..06 | UNIT ✔; limits BLOCKED OQ-21 |
| AC-POS-09 | FR-POS-12 Offline | With no connection the Complete button is disabled and the cart is retained; on reconnect a pending submission is retried with the same key | T6.04 | TC-PAY-06 | — |
| AC-POS-10 | Speed | A 3-line cart with a handheld scanner and one cash payment completes in ≤ 30 s median for trained staff; a new cashier completes basic billing after ≤ 10 min training | T9.01 | UAT-05 | — |
| AC-POS-11 | Stay in billing | After a successful sale the cashier remains in Billing with focus in the scan field and an empty cart in ≤ 1 action | T6.04 | UI test | — |
| AC-POS-12 | Honest status | The UI never shows "paid" or "saved" before the server confirms; on network loss it shows a checking state and retries with the same key | T6.04 | TC-PAY-06 | — |

## F. Payments and cash

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-PAY-01 | FR-PAY-02 Reconcile | Σ payments equals the grand total to the paisa; under/over/no payment rejected | T6.03 | TC-PAY-01 | UNIT ✔ |
| AC-PAY-02 | FR-PAY-02/03 Split + change | Split across cash/UPI/card works; change only from cash; tendered ≥ cash amount | T6.03 | TC-PAY-02, 05 | UNIT ✔ |
| AC-PAY-03 | FR-PAY-04 Failed payment | UPI/card without explicit "received" confirmation is rejected; nothing is recorded; no invoice | T6.03 | TC-PAY-03 | UNIT ✔ |
| AC-PAY-04 | FR-PAY-05 Correction | Manager corrects a payment method in an open session via reversal + new row, audited | T7.06 | TC-PAY-07 | — |
| AC-CSH-01 | FR-CSH-01..04 Sessions | One open session per counter; close computes expected cash = float + cash in − cash refunds + pay-ins − pay-outs; variance recorded; sign-off per OQ-22 | T6.06, T8.04 | TC-RPT-04, UAT-11 | — |

## G. Invoices, printing, returns

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-INV-01 | FR-INV-01 Invoice content | Printed invoice contains every field agreed in OQ-12, validated by the client's accountant | T6.05 | UAT-05 | BLOCKED OQ-12 |
| AC-INV-02 | FR-INV-02/07 Receipt + print failure | Thermal receipt matches the approved layout; with the printer offline the invoice remains saved and a reprint works | T6.05 | TC-HW-03, 05 | — |
| AC-INV-03 | FR-INV-06 Immutable | UPDATE/DELETE on issued invoices, lines and payments is impossible for every role | T6.02 | TC-SEC-10 | — |
| AC-INV-04 | FR-INV-04 Reprint | Reprints carry the duplicate marking, need `sale.view`, and are logged | T7.03 | UAT-09 | — |
| AC-RET-01 | FR-RET-02 Partial returns | Returned quantity cannot exceed sold − already returned (database-enforced) | T7.04 | TC-RET-01 | — |
| AC-RET-02 | FR-RET-04/07 Refund + policy | Refund ≤ credit note; outside-policy returns need a valid single-use approval | T7.04 | TC-RET-01, TC-SEC-18 | BLOCKED OQ-19 |
| AC-RET-03 | FR-RET-06 Exchange | Return and new sale commit atomically; failure of either leaves nothing | T7.05 | TC-RET-02 | — |
| AC-RET-04 | FR-INV-05 Void | Void works only the same business day with an open session; reverses stock and payments; number kept as VOIDED | T7.06 | TC-RET-03 | BLOCKED OQ-34 |
| AC-RET-05 | FR-RET-08 Jewellery refund value | Defaults to original line value; other valuation not available until OQ-20 | T7.04 | TC-RET-01 | BLOCKED OQ-20 |

## H. Purchases, reports

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-PUR-01 | FR-PUR-02 Goods receipt | Posting creates stock/items and movements atomically; posting twice with one key changes stock once; cancelling a receipt with consumed stock is refused | T7.01 | TC-INV-03 | — |
| AC-RPT-01 | FR-RPT-02..10 Reconciliation | Each report total equals the sum of the underlying records for the same filters (difference = ₹0.00) | T8.01 | TC-RPT-01 | — |
| AC-RPT-02 | FR-RPT-04 Tax summary | Tax summary by rate and HSN matches invoice-level tax, including credit notes | T8.01 | TC-RPT-01 | BLOCKED OQ-09..11 |
| AC-RPT-03 | FR-RPT-11 Export | CSV export is permission-gated, audited, and neutralises formula characters | T8.03 | TC-RPT-03 | — |

## I. UX, accessibility, performance, operations

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-UX-01 | UX plan §2 Navigation | Owners see exactly five navigation items; cashiers see Billing and Sales only and land in Billing after login; no nested menus; absent permissions are not shown as disabled items | T1.06, T6.04 | Unit + UI | Navigation rules UNIT ✔; UI — |
| AC-UX-02 | UX plan §6 States | Every data view has loading, empty, error, success (where relevant) and permission-denied states | T1.06, T3.04, T6.04, T7.03, T8.02, T2.10 | UI tests | — |
| AC-UX-03 | NFR-06 Accessibility | 0 critical/serious axe violations on core screens; billing completable by keyboard alone; contrast ≥ 4.5:1 for text | T9.04 | TC-A11Y-01, 02 | — |
| AC-UX-04 | Responsive | Billing is usable at 360, 768 and 1366 px; no horizontal scroll | T6.04 | TC-RESP-01 | — |
| AC-PERF-01 | NFR-02 Performance | Budgets in TC-PERF-01..06 met on staging (Mumbai region) | T9.03 | TC-PERF-* | — |
| AC-OPS-01 | NFR-04 Recovery | A restore drill recovers the latest backup into a scratch project and passes the integrity queries within RTO 4 h | T9.06 | Runbook §8 | — |
| AC-OPS-02 | Environments | `npm ci && npm run lint && npm run typecheck && npm test && npm run build` pass on a clean clone in CI | T1.04 | CI | Local run ✔; CI — |
| AC-OPS-03 | Release config | Production deployment contains no demo identity, demo backend or fixture data; secrets only in server environment | T9.06 | Runbook §6 checklist | — |

## J. Additional criteria (full requirement coverage)

Added so that every PRD requirement has at least one measurable criterion. Same status key as above.

| ID | Requirement | Pass criterion | Task | Test | Status |
|---|---|---|---|---|---|
| AC-PLT-04 | FR-PLT-04 Tenant metadata | A platform admin sees tenant status, branch count, user count, creation date and last activity and **no** business rows | T2.07 | TC-SEC-12 | — |
| AC-TEN-03 | FR-TEN-01 Tenant profile | Owner saves legal name, GSTIN, state, address and invoice header/footer; the values appear on the next printed invoice | T2.10 | TC-SET-01 | — |
| AC-TEN-04 | FR-TEN-04 Tenant settings | Each setting in DATABASE_DESIGN §3.2 is editable by the owner only, audited, and an unset value blocks its dependent feature (no silent default) | T2.10 | TC-SET-02 | — |
| AC-USR-03 | FR-USR-03 Permission-based access | Every action is guarded by a named permission; changing a role's permissions changes access on the next request | T2.05 | TC-SEC-08 | Partial rule UNIT ✔ (`sale.create`, discount authority) |
| AC-USR-04 | FR-USR-05 Idle lock | After the configured idle time the POS locks and needs the password; the cart draft is retained | T2.06 | TC-USR-01 | — |
| AC-USR-05 | FR-USR-06 Password reset | A reset link works once and expires; the response is identical for known and unknown emails | T2.06 | TC-USR-01 | — |
| AC-USR-06 | FR-USR-07 Individual logins | Two staff cannot share one login by design; every audit row names an individual | T2.10 | TC-USR-02 | — |
| AC-CAT-01 | FR-CAT-01/02 Categories and brands | Categories are limited to two levels with a consistent product kind; brand names are unique ignoring case | T3.01 | TC-CAT-01 | — |
| AC-CAT-02 | FR-CAT-03 Search | Search by name, SKU, style or design returns in ≤ 1 s p95 at 100,000 variants; barcodes and tag codes are never partially matched | T3.04 | TC-CAT-02, TC-BAR-03 | Barcode rule UNIT ✔ (demo) |
| AC-CAT-03 | FR-CAT-05 No hard delete | A record referenced by a transaction cannot be deleted; it can only be deactivated | T3.01 | TC-CAT-01 | — |
| AC-CAT-04 | FR-CAT-06 Images | JPEG/PNG/WebP up to 2 MB accepted; other types and larger files rejected; objects are tenant-scoped | T3.11 | TC-CAT-03 | — |
| AC-CLO-03 | FR-CLO-04/05/06 Variant price, stock, tags | Each variant stores selling price, optional cost and tax class, and branch stock; tag quantity is selectable per variant | T3.05 | TC-CLO-01 | — |
| AC-IMJ-02 | FR-IMJ-01/03/05 Imitation design and batch | Creating N items from one design yields N unique tags and barcodes with the same fixed price, each editable before sale | T3.07 | TC-IMJ-01 | — |
| AC-PMJ-03 | FR-PMJ-02/05 Pricing mode and history | A precious item chooses fixed-tag or metal-rate mode; its history timeline shows receipt, edits, prints, sale and return | T3.07, T3.08 | TC-PMJ-01 | — |
| AC-PRC-07 | FR-PRC-02/03 Rule engine and breakdown | A rule is data (components from a closed list, versioned, owner-activated); the bill shows each component; no free-form formula is accepted | T5.02, T5.03 | TC-PRC-07, TC-PRC-11 | BLOCKED OQ-01, OQ-12 |
| AC-PRC-08 | FR-PRC-08 Rounding | Component, line and invoice rounding follow tenant configuration; unset rounding leaves amounts to the paisa | T5.02 | TC-PRC-11 | BLOCKED OQ-08 |
| AC-PRC-09 | FR-PRC-09 Fixed price always available | A precious item with a tag price can be sold without any pricing rule or metal rate being configured | T3.07 | TC-PMJ-01 | — |
| AC-LBL-03 | FR-LBL-04 Label print log | Each label batch records user, time, items and quantities | T4.05 | TC-LBL-01 | — |
| AC-POS-13 | FR-POS-01 Session gate | Completing a bill without an open session is refused; scanning into the cart is allowed | T6.06 | TC-POS-01, TC-CHK-08 | UNIT ✔ (completion refused) |
| AC-POS-14 | FR-POS-05 Customer details | Walk-in sales need no customer; details become mandatory only above the configured threshold, with an explanatory message | T6.04 | TC-POS-01 | BLOCKED OQ-24 |
| AC-POS-15 | FR-POS-10/11 Draft and keyboard | A cart survives a page refresh on the same device; scan, quantity, pay and complete work from the keyboard alone | T6.04 | TC-POS-01, TC-A11Y-02 | — |
| AC-PAY-05 | FR-PAY-01 Payment methods and references | Cash, UPI and card are recorded; UPI/card references are captured and mandatory only when configured | T6.03 | TC-PAY-08 | UNIT ✔ (methods); references BLOCKED OQ-22 |
| AC-PAY-06 | FR-PAY-06 Cash limits | Warn or block above the configured cash amount; PAN captured above the threshold; no legal value is hard-coded | T6.03 | TC-PAY-08 | BLOCKED OQ-23 |
| AC-PAY-07 | FR-PAY-07 No credit tender | Pay-later, voucher and store-credit tenders do not exist; any other method is rejected | T6.03 | TC-PAY-04 | UNIT ✔ |
| AC-INV-05 | FR-INV-03/08 A4 and QR | A4 layout prints; the receipt QR code opens the invoice in Sales when scanned | T6.05 | TC-INV-05 | — |
| AC-RET-06 | FR-RET-01/03/05 Return lookup, credit note, disposition | A return starts from an invoice found by number, scan or search; issues a credit note from its own gapless series; routes each line to the chosen stock bucket | T7.04 | TC-RET-01, TC-RET-04 | BLOCKED OQ-13 |
| AC-PUR-02 | FR-PUR-01/03/04/05 Suppliers and receipt details | Supplier master maintained; receipt captures supplier invoice and costs; cancel allowed only when unused; label printing offered after posting | T7.01 | TC-PUR-01 | — |
| AC-STK-04 | FR-STK-02/04/06 Opening stock, enquiry, reorder | Opening stock imports as `OPENING` movements; enquiry shows balance and history; the low-stock list uses the reorder level | T3.08, T3.09 | TC-STK-01 | BLOCKED OQ-30 |
| AC-CSH-02 | FR-CSH-05 Settlement lists | The Z-report lists UPI and card payments with references so they can be matched to settlement reports | T8.04 | TC-RPT-05 | BLOCKED OQ-22 |
| AC-RPT-04 | FR-RPT-01/12 Numbers and rate history | Dashboard numbers and the metal-rate history reconcile with the ledger | T8.01, T8.02 | TC-RPT-05 | — |
| AC-AUD-02 | FR-AUD-03 Retention and viewing | Retention follows the approved period; owners filter by date, user, action, entity; no row can be altered | T2.04, T7.07 | TC-AUD-01 | BLOCKED OQ-33 |
| AC-NFR-03 | NFR-03 Availability | Monthly availability during store hours ≥ 99.5% excluding provider incidents; an outage raises an alert | T9.06 | TC-OPS-01 | — |
| AC-NFR-05 | NFR-05 Compatibility | The billing smoke script passes on Chrome/Edge (Windows), Chrome (Android 10+), Safari (iOS 17+) at ≥ 1366 × 768 on the counter | T9.01, T9.05 | TC-OPS-02 | — |
| AC-NFR-07 | NFR-07 Localisation | Currency uses Indian digit grouping; dates are DD-MM-YYYY in the branch time zone | T1.06 | TC-I18N-01 | Currency UNIT ✔; dates — |
| AC-NFR-08 | NFR-08 Auditability | Each financial state change can be traced to a user, time and reason in the audit log | T2.04 | TC-AUD-01 | — |
| AC-NFR-09 | NFR-09 Maintainability | Strict TypeScript, zero lint errors, coverage gates met (≥ 90% pricing/tax/checkout/inventory, ≥ 70% overall) | T1.02, T1.04 | TC-OPS-03 | Lint/types ✔; coverage gates — |
| AC-NFR-10 | NFR-10 Privacy | Minimum customer data, masked phone for roles without full-view permission, no personal data in logs or error reports | T9.02 | TC-PRIV-01, TC-OPS-04 | — |
| AC-NFR-11 | NFR-11 Scalability | The launch sizing (100,000 variants, 50,000 items, 2,000 invoices/day) meets the performance budgets | T9.03 | TC-OPS-06 | — |
| AC-NFR-12 | NFR-12 Observability | Correlated error reports and checkout-failure alerts exist and a health endpoint is monitored | T9.06 | TC-OPS-04, TC-OPS-01 | — |
| AC-NFR-13 | NFR-13 Data residency | Database and storage run in the agreed India region | T9.06 | TC-OPS-05 | — |

## Summary of today's evidence

- Verified at **unit level** (130 tests): AC-SEC-02, 03, 05 (action layer), AC-MON-01, AC-POS-01 to 08 (rules, sequential), AC-PAY-01 to 03, parts of AC-BAR-01, AC-IMJ-01, AC-STK-02 and AC-UX-01.
- **Not verified** at all: everything requiring a database, authentication, UI, hardware or the client's business rules.
- **Blocked** on client decisions: AC-PRC-01/02/05, AC-TAX-01, AC-LBL-01/02, AC-INV-01, AC-RET-02/04/05, AC-RPT-02 and the discount limits in AC-POS-08.
