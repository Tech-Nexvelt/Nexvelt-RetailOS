# NexVelt RetailOS — Requirements Traceability and Status

| Field | Value |
|---|---|
| Document ID | NXR-TRACE |
| Date | 2026-10-10 |
| Generated from | PRD requirement tables and ACCEPTANCE_CRITERIA.md (ranges such as FR-CLO-01..03 expanded) |

**Status vocabulary**

| Status | Meaning |
|---|---|
| **Complete** | Built **and** verified in the environment that proves the claim (database claims need a database). *Nothing is Complete yet.* |
| **Mocked: unit-verified only** | The rule exists in the in-memory demo engine or server-action layer and passes unit tests. It is **not** database-backed, authenticated or user-visible. |
| **Incomplete** | Partly built. |
| **Awaiting approval** | Needs a client decision (open question) before it can be built or enabled. No answer has been invented. |
| **Not started** | Specified only. |
| **No criterion yet** | The PRD requirement has no acceptance criterion in ACCEPTANCE_CRITERIA.md. This is a documentation gap. |

| Requirement | Summary | Acceptance criteria | Tasks | Tests | Status |
|---|---|---|---|---|---|
| FR-PLT-01 | A platform administrator can create a tenant (legal name, trade name, code) and invite its | AC-PLT-01 | T2.07 | TC-SEC-12, UAT-01 | Not started |
| FR-PLT-02 | A platform administrator can suspend and reactivate a tenant. Users of a suspended tenant  | AC-PLT-02 | T2.07 | TC-SEC-07 | Not started |
| FR-PLT-03 | Platform administrators have **no default access** to tenant business data (products, invo | AC-PLT-03 | T2.03 | TC-SEC-12..14 | Not started |
| FR-PLT-04 | A platform administrator can view non-business tenant metadata: status, branch count, user | AC-PLT-04 | T2.07 | TC-SEC-12 | Not started |
| FR-TEN-01 | The Tenant Owner maintains the tenant profile: legal name, trade name, registered address, | AC-TEN-03 | T2.10 | TC-SET-01 | Not started |
| FR-TEN-02 | The Tenant Owner can create, edit and deactivate branches: code, name, address, phone, GST | AC-TEN-01 | T2.05 | UAT-01 | Not started |
| FR-TEN-03 | The Tenant Owner or Branch Manager can create, edit and deactivate billing counters within | AC-TEN-01 | T2.05 | UAT-01 | Not started |
| FR-TEN-04 | Tenant settings: price tax-inclusivity per product kind (OQ-11), rounding rules (OQ-08), n | AC-TEN-04 | T2.10 | TC-SET-02 | Not started |
| FR-TEN-05 | A user with more than one branch membership selects an active branch. Every branch-scoped  | AC-TEN-02 | T2.05 | TC-SEC-04 | Not started |
| FR-USR-01 | The Tenant Owner invites users by email, assigns a tenant role and one or more branch memb | AC-USR-01 | T2.05 | TC-SEC-06 | Not started |
| FR-USR-02 | The Tenant Owner can deactivate a user's membership. The change takes effect on the user's | AC-USR-01 | T2.05 | TC-SEC-06 | Not started |
| FR-USR-03 | Authorization is permission-based. System roles (`tenant_owner`, `branch_manager`, `cashie | AC-USR-03 | T2.05 | TC-SEC-08 | Mocked: unit-verified only |
| FR-USR-04 | Passwords must meet the configured policy (minimum 10 characters, breached-password check  | AC-USR-02 | T2.06 | TC-SEC-15 | Not started |
| FR-USR-05 | The POS screen locks after a configurable idle period (default 10 minutes) and requires re | AC-USR-04 | T2.06 | TC-USR-01 | Not started |
| FR-USR-06 | Users can reset their password through an emailed link. | AC-USR-05 | T2.06 | TC-USR-01 | Not started |
| FR-USR-07 | Every cashier and manager uses an individual account. Shared logins are not supported, bec | AC-USR-06 | T2.10 | TC-USR-02 | Not started |
| FR-CAT-01 | Categories are hierarchical (maximum two levels). Each category declares a product kind (` | AC-CAT-01 | T3.01 | TC-CAT-01 | Not started |
| FR-CAT-02 | Brands are maintained per tenant. Names are unique case-insensitively. | AC-CAT-01 | T3.01 | TC-CAT-01 | Not started |
| FR-CAT-03 | Users can find sellable items by name, SKU, style code, design code, barcode or tag ID. Re | AC-CAT-02 | T3.04 | TC-CAT-02, TC-BAR-03 | Mocked: unit-verified only |
| FR-CAT-04 | Bulk CSV import for categories, brands, products/variants, jewellery items and opening sto | AC-IMP-01 | T3.09 | TC-INV-02 | Not started |
| FR-CAT-05 | Records that are referenced by transactions cannot be deleted. They can only be deactivate | AC-CAT-03 | T3.01 | TC-CAT-01 | Not started |
| FR-CAT-06 | Optional product/design image upload (JPEG/PNG/WebP, ≤ 2 MB each). | AC-CAT-04 | T3.11 | TC-CAT-03 | Not started |
| FR-CLO-01 | A clothing product (style) has brand, category, style code (unique per tenant), name, desc | AC-CLO-01 | T3.05, T3.06 | UAT-02 | Not started |
| FR-CLO-02 | Variants are generated from a size × colour matrix. Each variant has a SKU that is unique  | AC-CLO-01 | T3.05, T3.06 | UAT-02 | Not started |
| FR-CLO-03 | Every sellable variant has exactly one primary barcode, unique within the tenant across al | AC-CLO-01 | T3.05, T3.06 | UAT-02 | Not started |
| FR-CLO-04 | Each variant has a purchase cost, a selling price and a tax class (inherited from the prod | AC-CLO-03 | T3.05 | TC-CLO-01 | Not started |
| FR-CLO-05 | Stock is held per variant per branch as an integer quantity. | AC-CLO-03 | T3.05 | TC-CLO-01 | Not started |
| FR-CLO-06 | Product tags can be printed per variant for a chosen quantity (FR-LBL). | AC-CLO-03 | T3.05 | TC-CLO-01 | Not started |
| FR-IMJ-01 | A design master has design code (unique per tenant), category, name, HSN code, tax class a | AC-IMJ-02 | T3.07 | TC-IMJ-01 | Not started |
| FR-IMJ-02 | Every physical piece is a separate item with a unique tag ID and barcode. | AC-IMJ-01 | T3.07 | TC-INV-01 | Mocked: unit-verified only |
| FR-IMJ-03 | Each item has a fixed-tag selling price and a purchase cost. | AC-IMJ-02 | T3.07 | TC-IMJ-01 | Not started |
| FR-IMJ-04 | Stock is tracked per item by status (`IN_STOCK`, `SOLD`, `QC_HOLD`, `DAMAGED`, `WRITTEN_OF | AC-IMJ-01 | T3.07 | TC-INV-01 | Mocked: unit-verified only |
| FR-IMJ-05 | During a goods receipt or opening-stock import, a user can create N items from one design  | AC-IMJ-02 | T3.07 | TC-IMJ-01 | Not started |
| FR-PMJ-01 | Each item records: unique tag ID; design; metal type; purity; gross weight; net metal weig | AC-PMJ-01 | T3.07 | — | Not started |
| FR-PMJ-02 | Each item has a pricing mode: `FIXED_TAG` (stored tag price) or `METAL_RATE` (price calcul | AC-PMJ-03 | T3.07, T3.08 | TC-PMJ-01 | Not started |
| FR-PMJ-03 | Weights are validated: gross > 0, 0 < net ≤ gross. Unit and precision follow OQ-04 (propos | AC-PMJ-01 | T3.07 | — | Not started |
| FR-PMJ-04 | Attributes that affect price (weights, purity, stones, pricing mode, tag price, pricing ru | AC-PMJ-02 | T3.02 | — | Not started |
| FR-PMJ-05 | Each item has a history timeline: receipt, edits, label prints, sale (with price snapshot) | AC-PMJ-03 | T3.07, T3.08 | TC-PMJ-01 | Not started |
| FR-PRC-01 | Authorized users record metal rates per metal type and purity, with an effective-from time | AC-PRC-02 | T5.01 | — | Awaiting approval (OQ-02, 05) |
| FR-PRC-02 | Metal-rate pricing rules are configured as data, not code. A rule is an ordered set of com | AC-PRC-07 | T5.02, T5.03 | TC-PRC-07, TC-PRC-11 | Awaiting approval (OQ-01, OQ-12) |
| FR-PRC-03 | When a metal-rate item is scanned, the POS displays a price breakdown (weights, rate, each | AC-PRC-07 | T5.02, T5.03 | TC-PRC-07, TC-PRC-11 | Awaiting approval (OQ-01, OQ-12) |
| FR-PRC-04 | At sale, the invoice line stores an immutable snapshot of the rate record, rate value, pur | AC-PRC-03 | T5.02, T6.03 | TC-PRC-09 | Not started |
| FR-PRC-05 | If the effective rate or rule changes between quotation and checkout, checkout is rejected | AC-PRC-04 | T6.03 | TC-PRC-09 | Mocked: unit-verified only |
| FR-PRC-06 | A `METAL_RATE` item cannot be sold when no rate for its metal and purity is effective for  | AC-PRC-05 | T5.04 | TC-PRC-10 | Awaiting approval (OQ-02) |
| FR-PRC-07 | **No pricing formula is hard-coded.** Production go-live requires the Tenant Owner to appr | AC-PRC-01 | T5.05 | TC-PRC-07 | Awaiting approval (OQ-01) |
| FR-PRC-08 | Rounding of component amounts, line totals and invoice totals follows tenant configuration | AC-PRC-08 | T5.02 | TC-PRC-11 | Awaiting approval (OQ-08) |
| FR-PRC-09 | Fixed-tag pricing is available for precious items regardless of rule configuration. | AC-PRC-09 | T3.07 | TC-PMJ-01 | Not started |
| FR-BAR-01 | The system generates barcode values for variants and jewellery items, rendered as Code 128 | AC-BAR-01 | T4.01 | TC-BAR-01..03 | Mocked: unit-verified only |
| FR-BAR-02 | Existing manufacturer/supplier barcodes (EAN-13, UPC-A, Code 128) can be registered as ali | AC-BAR-01 | T4.01 | TC-BAR-01..03 | Mocked: unit-verified only |
| FR-BAR-03 | USB and Bluetooth handheld scanners in HID keyboard mode work on the POS, receiving, label | AC-BAR-02 | T4.03 | TC-HW-01 | Not started |
| FR-BAR-04 | Phone-camera scanning works on supported browsers (Chrome on Android; Safari on iOS 17+),  | AC-BAR-03 | T4.04 | TC-HW-02, TC-BAR-08 | Not started |
| FR-BAR-05 | Manual code entry and text search are always available as a fallback when a scanner or cam | AC-BAR-03 | T4.04 | TC-HW-02, TC-BAR-08 | Not started |
| FR-BAR-06 | Scanning gives distinct audible and visual feedback for each outcome: added, unknown code, | AC-BAR-04 | T6.04 | TC-BAR-04 | Mocked: unit-verified only |
| FR-LBL-01 | Label templates per product kind (clothing tag, jewellery tag) with configurable dimension | AC-LBL-01 | T4.05, T4.06 | TC-HW-04 | Awaiting approval (OQ-14..17) |
| FR-LBL-02 | Labels can be printed from a product, a goods receipt, a jewellery item list or a search s | AC-LBL-01 | T4.05, T4.06 | TC-HW-04 | Awaiting approval (OQ-14..17) |
| FR-LBL-03 | A true-size preview and a calibration test print are available. | AC-LBL-01 | T4.05, T4.06 | TC-HW-04 | Awaiting approval (OQ-14..17) |
| FR-LBL-04 | Each label print batch is logged (user, time, items, quantities). | AC-LBL-03 | T4.05 | TC-LBL-01 | Not started |
| FR-LBL-05 | Metal-rate items print weights and purity but not a calculated price on the label, because | AC-LBL-02 | T4.05 | — | Awaiting approval (OQ-15) |
| FR-POS-01 | Billing requires an open cash session for the counter (FR-CSH-01). | AC-POS-13 | T6.06 | TC-POS-01, TC-CHK-08 | Mocked: unit-verified only |
| FR-POS-02 | One cart accepts clothing variants, imitation jewellery items and precious jewellery items | AC-POS-01 | T6.04 | TC-CHK-01, TC-BAR-04 | Mocked: unit-verified only |
| FR-POS-03 | Scanning a variant adds it or increments its quantity. Scanning a jewellery item adds it o | AC-POS-01 | T6.04 | TC-CHK-01, TC-BAR-04 | Mocked: unit-verified only |
| FR-POS-04 | Line-level and invoice-level discounts (percentage or amount) are allowed within the role' | AC-POS-08 | T6.03, T6.07 | TC-PRC-04..06 | Awaiting approval (OQ-21) |
| FR-POS-05 | Customer details (name, phone, GSTIN, address, state) are optional or mandatory according  | AC-POS-14 | T6.04 | TC-POS-01 | Awaiting approval (OQ-24) |
| FR-POS-06 | The server calculates line totals, tax breakdown (CGST/SGST or IGST by place of supply), r | AC-POS-02 | T6.03 | TC-PRC-02 | Mocked: unit-verified only |
| FR-POS-07 | Checkout is atomic. Invoice, lines, price snapshots, payments, stock decrements, jewellery | AC-POS-03 | T6.03 | TC-CHK-05 | Mocked: unit-verified only |
| FR-POS-08 | Duplicate-sale prevention: each checkout carries an idempotency key, and retries or double | AC-POS-04 | T6.03, T6.08 | TC-CHK-02, TC-CONC-03 | Mocked: unit-verified only |
| FR-POS-09 | Invoice numbers are gapless and consecutive per branch per financial year, in the format a | AC-POS-07 | T6.03 | TC-CHK-06 | Mocked: unit-verified only |
| FR-POS-10 | The in-progress cart survives a page refresh on the same device (local draft). This is not | AC-POS-15 | T6.04 | TC-POS-01, TC-A11Y-02 | Not started |
| FR-POS-11 | Core billing can be operated by keyboard alone (scan, quantity, discount, pay, print). | AC-POS-15 | T6.04 | TC-POS-01, TC-A11Y-02 | Not started |
| FR-POS-12 | If connectivity is lost, the POS shows a clear offline banner, disables checkout, keeps th | AC-POS-09 | T6.04 | TC-PAY-06 | Not started |
| FR-POS-13 | A bill must have a total payable above ₹0.00. A bill whose discounts reduce the total to z | AC-POS-08 | T6.03, T6.07 | TC-PRC-04..06 | Awaiting approval (OQ-21) |
| FR-PAY-01 | Payments are recorded manually as `CASH`, `UPI` or `CARD`. UPI and card payments capture a | AC-PAY-05 | T6.03 | TC-PAY-08 | Awaiting approval (OQ-22) |
| FR-PAY-02 | Split payments across any combination of methods. The sum of applied payment amounts must  | AC-PAY-01, AC-PAY-02 | T6.03 | TC-PAY-01, TC-PAY-02 | Mocked: unit-verified only |
| FR-PAY-03 | For cash, the tendered amount is recorded and change is calculated. Tendered must be ≥ the | AC-PAY-02 | T6.03 | TC-PAY-02 | Mocked: unit-verified only |
| FR-PAY-04 | For each non-cash payment, the cashier must explicitly confirm that the payment succeeded  | AC-PAY-03 | T6.03 | TC-PAY-03 | Mocked: unit-verified only |
| FR-PAY-05 | A manager can correct the payment method of an invoice while its cash session is open, for | AC-PAY-04 | T7.06 | TC-PAY-07 | Not started |
| FR-PAY-06 | Configurable cash-acceptance threshold per invoice with warn/block behaviour, and PAN capt | AC-PAY-06 | T6.03 | TC-PAY-08 | Awaiting approval (OQ-23) |
| FR-PAY-07 | Credit (pay-later) sales, gift vouchers and store credit are not supported at launch (§15) | AC-PAY-07 | T6.03 | TC-PAY-04 | Mocked: unit-verified only |
| FR-INV-01 | Each invoice contains the fields required by the agreed invoice specification (OQ-12): sel | AC-INV-01 | T6.05 | UAT-05 | Awaiting approval (OQ-12) |
| FR-INV-02 | Thermal receipt printing at 80 mm (58 mm optional) through the browser print pipeline. | AC-INV-02 | T6.05 | TC-HW-03 | Not started |
| FR-INV-03 | A4 invoice layout (useful for jewellery and B2B customers) through the browser print pipel | AC-INV-05 | T6.05 | TC-INV-05 | Not started |
| FR-INV-04 | Reprints are labelled "DUPLICATE" (wording per OQ-12), require the `sale.view` permi | AC-INV-04 | T7.03 | UAT-09 | Not started |
| FR-INV-05 | Void: an invoice may be voided only on the same business day, while its cash session is op | AC-RET-04 | T7.06 | TC-RET-03 | Awaiting approval (OQ-34) |
| FR-INV-06 | Issued invoices are immutable. Corrections after the void window go through returns and cr | AC-INV-03 | T6.02 | TC-SEC-10 | Not started |
| FR-INV-07 | A failed receipt print never affects the saved invoice. The UI shows "Invoice saved — prin | AC-INV-02 | T6.05 | TC-HW-03 | Not started |
| FR-INV-08 | Receipts carry a scannable invoice barcode or QR code (invoice number) to speed up returns | AC-INV-05 | T6.05 | TC-INV-05 | Not started |
| FR-RET-01 | Returns are always against an original invoice, found by invoice number, receipt barcode o | AC-RET-06 | T7.04 | TC-RET-01, TC-RET-04 | Awaiting approval (OQ-13) |
| FR-RET-02 | Partial returns are allowed. The returned quantity per line cannot exceed the sold quantit | AC-RET-01 | T7.04 | TC-RET-01 | Not started |
| FR-RET-03 | Each return issues a credit note with its own gapless number series per branch per financi | AC-RET-06 | T7.04 | TC-RET-01, TC-RET-04 | Awaiting approval (OQ-13) |
| FR-RET-04 | Refunds are recorded manually as cash, UPI or card and cannot exceed the credit note value | AC-RET-02 | T7.04 | TC-RET-01, TC-SEC-18 | Awaiting approval (OQ-19) |
| FR-RET-05 | Each returned line has a disposition: `RESTOCK` (back to sellable stock), `QC_HOLD` (not s | AC-RET-06 | T7.04 | TC-RET-01, TC-RET-04 | Awaiting approval (OQ-13) |
| FR-RET-06 | An exchange performs the return and a new sale in one atomic transaction, with net settlem | AC-RET-03 | T7.05 | TC-RET-02 | Not started |
| FR-RET-07 | The return window, non-returnable categories and approval requirements are configurable. R | AC-RET-02 | T7.04 | TC-RET-01, TC-SEC-18 | Awaiting approval (OQ-19) |
| FR-RET-08 | The refund value of a returned precious-metal item defaults to the original invoice line v | AC-RET-05 | T7.04 | TC-RET-01 | Awaiting approval (OQ-20) |
| FR-PUR-01 | Supplier master: name, GSTIN, state, contact details, active flag. | AC-PUR-02 | T7.01 | TC-PUR-01 | Not started |
| FR-PUR-02 | A goods receipt (GRN) is created as a draft and then posted. Posting atomically increases  | AC-PUR-01 | T7.01 | TC-INV-03 | Not started |
| FR-PUR-03 | A goods receipt captures supplier invoice number and date, line costs and input-tax amount | AC-PUR-02 | T7.01 | TC-PUR-01 | Not started |
| FR-PUR-04 | A posted receipt can be cancelled by a manager only if none of its stock has been consumed | AC-PUR-02 | T7.01 | TC-PUR-01 | Not started |
| FR-PUR-05 | After posting a goods receipt, the user is offered label printing for all of its lines. | AC-PUR-02 | T7.01 | TC-PUR-01 | Not started |
| FR-STK-01 | Every stock change is an append-only ledger movement with type, quantity, reference docume | AC-STK-01 | T3.03, T3.10 | TC-INV-01 | Mocked: unit-verified only |
| FR-STK-02 | Opening stock is loaded through import (FR-CAT-04) as `OPENING` movements on an agreed cut | AC-STK-04 | T3.08, T3.09 | TC-STK-01 | Awaiting approval (OQ-30) |
| FR-STK-03 | Stock adjustments (increase/decrease) have a reason code (count correction, damage, loss/t | AC-STK-03 | T7.02 | TC-INV-04 | Not started |
| FR-STK-04 | Stock enquiry by branch, product, variant, design and item status, with movement history. | AC-STK-04 | T3.08, T3.09 | TC-STK-01 | Awaiting approval (OQ-30) |
| FR-STK-05 | Negative stock is blocked by default. If OQ-25 allows it, it is permitted only with manage | AC-STK-02 | T3.03 | TC-CHK-07, TC-CONC-02 | Mocked: unit-verified only |
| FR-STK-06 | Variant reorder level, with a low-stock list on the dashboard. | AC-STK-04 | T3.08, T3.09 | TC-STK-01 | Awaiting approval (OQ-30) |
| FR-CSH-01 | A cash session is opened per counter with an opening float. Only one session can be open p | AC-CSH-01 | T6.06, T8.04 | TC-RPT-04, UAT-11 | Not started |
| FR-CSH-02 | Cash pay-ins and pay-outs (for example petty expenses) are recorded with a reason during a | AC-CSH-01 | T6.06, T8.04 | TC-RPT-04, UAT-11 | Not started |
| FR-CSH-03 | Closing a session requires a counted cash amount (denomination entry optional). The system | AC-CSH-01 | T6.06, T8.04 | TC-RPT-04, UAT-11 | Not started |
| FR-CSH-04 | A printable session close report (Z-report) shows totals per payment method, invoice count | AC-CSH-01 | T6.06, T8.04 | TC-RPT-04, UAT-11 | Not started |
| FR-CSH-05 | UPI and card totals per session are listed with references, so they can be matched manuall | AC-CSH-02 | T8.04 | TC-RPT-05 | Awaiting approval (OQ-22) |
| FR-RPT-01 | Dashboard for the active branch (or all branches for owners): today's sales, invoice count | AC-RPT-04 | T8.01, T8.02 | TC-RPT-05 | Not started |
| FR-RPT-02 | Sales register filtered by date range, branch, counter, cashier, category and product kind | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-03 | Payment summary by method and date, including refunds and corrections. | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-04 | Tax summary by tax rate and HSN, separating intra-state and inter-state, and including cre | AC-RPT-01, AC-RPT-02 | T8.01 | TC-RPT-01 | Awaiting approval (OQ-09..11) |
| FR-RPT-05 | Stock on hand and stock valuation at cost per branch (requires `cost.view`). | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-06 | Inventory movement ledger per item or variant with running balance. | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-07 | Jewellery item register: tag ID, design, metal, purity, weights, status and branch, with t | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-08 | Returns and credit-note report. | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-09 | Purchase report by supplier and period. | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-10 | Cash session history and variance report. | AC-RPT-01 | T8.01 | TC-RPT-01 | Not started |
| FR-RPT-11 | Every report can be exported as CSV. Exports require `report.export` and are audited. | AC-RPT-03 | T8.03 | TC-RPT-03 | Not started |
| FR-RPT-12 | Metal rate history report. | AC-RPT-04 | T8.01, T8.02 | TC-RPT-05 | Not started |
| FR-AUD-01 | Security events (sign-in, MFA, membership changes, support access), master-data changes (p | AC-AUD-01 | T2.04 | TC-SEC-10 | Not started |
| FR-AUD-02 | The audit log is append-only: no user, including the Tenant Owner, can edit or delete entr | AC-AUD-01 | T2.04 | TC-SEC-10 | Not started |
| FR-AUD-03 | Retention follows OQ-33. Until that is decided, entries are retained for the life of the s | AC-AUD-02 | T2.04, T7.07 | TC-AUD-01 | Awaiting approval (OQ-33) |
| NFR-01 | Security / isolation | AC-SEC-01 | T2.08 | TC-SEC-01..20 | Not started |
| NFR-02 | Performance | AC-PERF-01 | T9.03 | TC-PERF-* | Not started |
| NFR-03 | Availability | AC-NFR-03 | T9.06 | TC-OPS-01 | Not started |
| NFR-04 | Durability | AC-OPS-01 | T9.06 | — | Not started |
| NFR-05 | Compatibility | AC-NFR-05 | T9.01, T9.05 | TC-OPS-02 | Not started |
| NFR-06 | Accessibility | AC-UX-03 | T9.04 | TC-A11Y-01 | Not started |
| NFR-07 | Localization | AC-NFR-07 | T1.06 | TC-I18N-01 | Mocked: unit-verified only |
| NFR-08 | Auditability | AC-NFR-08 | T2.04 | TC-AUD-01 | Not started |
| NFR-09 | Maintainability | AC-NFR-09 | T1.02, T1.04 | TC-OPS-03 | Not started |
| NFR-10 | Privacy | AC-NFR-10 | T9.02 | TC-PRIV-01, TC-OPS-04 | Not started |
| NFR-11 | Scalability | AC-NFR-11 | T9.03 | TC-OPS-06 | Not started |
| NFR-12 | Observability | AC-NFR-12 | T9.06 | TC-OPS-04, TC-OPS-01 | Not started |
| NFR-13 | Data residency | AC-NFR-13 | T9.06 | TC-OPS-05 | Not started |
| NFR-14 | Integrity | AC-MON-01 | T1.02 | TC-PRC-01 | Mocked: unit-verified only |

## Summary

| Status | Count |
|---|---:|
| Awaiting approval | 29 |
| Mocked: unit-verified only | 23 |
| Not started | 87 |
| **Total requirements** | **139** |
