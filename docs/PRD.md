# NexVelt RetailOS — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Document ID | NXR-PRD |
| Version | 0.1 (Phase 0 baseline — draft for client review) |
| Date | 2026-10-10 |
| Status | Draft — awaiting review by Nexvelt and NR Collections |
| Related | [TRD](TRD.md) · [Implementation Plan](IMPLEMENTATION_PLAN.md) · [Database Design](DATABASE_DESIGN.md) · [API Specification](API_SPECIFICATION.md) · [Security Model](SECURITY_MODEL.md) · [Test Strategy](TEST_STRATEGY.md) · [Acceptance Criteria](ACCEPTANCE_CRITERIA.md) · [Deployment Runbook](DEPLOYMENT_RUNBOOK.md) · [Assumptions & Open Questions](ASSUMPTIONS_AND_OPEN_QUESTIONS.md) |

> **Convention.** Requirement IDs (`FR-*`, `NFR-*`) are stable. Acceptance criteria use the same IDs with an `AC-` prefix. Open questions (`OQ-*`) and assumptions (`A-*`) are defined in [ASSUMPTIONS_AND_OPEN_QUESTIONS.md](ASSUMPTIONS_AND_OPEN_QUESTIONS.md). Where a requirement depends on an unresolved business rule, it names the OQ, and the document does **not** invent the answer.

---

## 1. Product vision

NexVelt RetailOS is a cloud, multi-tenant point-of-sale (POS) and inventory platform for Indian specialty retailers that sell **mixed merchandise**: size/colour-variant apparel alongside individually tagged jewellery, including precious-metal jewellery priced from live metal rates.

Generic POS products handle apparel variants well but treat jewellery as plain SKUs. Jewellery-specific software handles weights and rates but is weak at fast apparel billing. RetailOS does both in **one cart, one invoice, one inventory ledger**, with strict tenant isolation so the same platform can serve many retailers.

### 1.1 Business goals

| ID | Goal |
|---|---|
| BG-01 | Put NR Collections' entire billing and inventory on RetailOS for its first branch and counter. |
| BG-02 | Eliminate double-selling of unique jewellery pieces and unexplained stock differences. |
| BG-03 | Give the owner same-day visibility of sales, payments, cash variance and stock. |
| BG-04 | Build a reusable multi-tenant SaaS foundation that Nexvelt can sell to further retailers without re-architecture. |
| BG-05 | Price precious-metal jewellery from client-approved, versioned rules with a full historical audit trail. |

### 1.2 Success metrics (measured during the first 60 days after go-live)

| ID | Metric | Target |
|---|---|---|
| SM-01 | Share of NR Collections sales billed through RetailOS | 100% from day 14 after go-live |
| SM-02 | Median time to bill a 3-line cart with a handheld scanner and a single payment (first scan to "invoice saved") | ≤ 30 s |
| SM-03 | Duplicate invoices or double-sold jewellery items | 0 |
| SM-04 | Cross-tenant data exposure incidents | 0 |
| SM-05 | Jewellery item stock accuracy at first physical verification | 100% of tagged items reconciled |
| SM-06 | Clothing variant stock accuracy at first physical count | ≥ 98% of variants match (differences explained by recorded adjustments) |
| SM-07 | Cash sessions closed with a recorded count | 100% of trading days |
| SM-08 | Production availability during store hours (excluding provider-declared incidents and planned maintenance) | ≥ 99.5% monthly |
| SM-09 | Severity-1 defects open at go-live | 0 |

---

## 2. Target customers and personas

### 2.1 Target customers

- **Launch customer:** NR Collections — clothing, imitation jewellery and precious-metal jewellery; one branch, one billing counter.
- **Future customers:** small to mid-sized Indian retailers (1–20 branches) selling apparel, fashion accessories and/or jewellery.

### 2.2 Personas

| Persona | Role key | Description | Primary needs |
|---|---|---|---|
| Platform Administrator | `platform_admin` | Nexvelt operations staff who run the SaaS. | Provision tenants, suspend tenants, monitor health. No routine access to tenant business data. |
| Tenant Owner | `tenant_owner` | Proprietor of NR Collections. | Full control of their business: users, branches, prices, metal rates, pricing rules, tax settings, all reports, audit. |
| Branch Manager | `branch_manager` | Runs a branch day-to-day. | Receive stock, print labels, approve returns, voids and adjustments, close cash sessions, branch reports. |
| Cashier | `cashier` | Counter staff. | Fast scanning, unified billing, split payments, printing receipts, simple returns that need manager approval. |
| End customer (indirect) | — | Buys goods. | Accurate bill, clear receipt, a clear jewellery price breakdown, and a fair returns process. |

Stock-keeping staff are not a separate persona at launch. Their tasks are performed under the Branch Manager role, or under a Cashier role granted additional permissions (the permission model supports custom roles in a future phase; see FR-USR-03).

---

## 3. Scope overview

### 3.1 Launch scope (Release 1.0)

1. Multi-tenant, multi-branch, multi-counter platform with membership-based access and PostgreSQL Row Level Security.
2. Catalogue: clothing products with size/colour variants, imitation jewellery designs and items, and precious-metal jewellery items.
3. Barcode generation, handheld (USB/Bluetooth HID) scanning, phone-camera scanning and label printing.
4. Precious-metal pricing in two modes — fixed-tag and metal-rate-based — using configurable, versioned rules and effective-dated rates.
5. Unified cart and atomic checkout with gapless invoice numbering, manual payment recording (cash/UPI/card, split) and thermal/A4 printing.
6. Purchases (goods receipts), opening stock, stock adjustments, returns, exchanges, voids, reprints and payment-method corrections.
7. Cash sessions, reconciliation, dashboard, operational reports and CSV export.
8. Audit log.
9. Hosting for an agreed initial period (proposed: three months after production go-live and acceptance; see §14).

### 3.2 Explicitly **not** in launch scope

See §13 (Future phases) and §15 (Exclusions). In particular, **offline billing, direct payment-gateway integration and branch transfers are not delivered in Release 1.0.**

---

## 4. Functional requirements

Priority: **P0** = required for launch, **P1** = launch, but go-live may proceed with a documented workaround if it slips, **P2** = desirable for launch, may move to post-launch backlog.

### 4.1 Platform administration (FR-PLT)

| ID | Requirement | Priority |
|---|---|---|
| FR-PLT-01 | A platform administrator can create a tenant (legal name, trade name, code) and invite its first Tenant Owner by email. | P0 |
| FR-PLT-02 | A platform administrator can suspend and reactivate a tenant. Users of a suspended tenant cannot access tenant data or perform operations. Data is retained. | P0 |
| FR-PLT-03 | Platform administrators have **no default access** to tenant business data (products, invoices, customers, stock). Access requires a time-bound support-access grant created by the Tenant Owner. Every grant and every access is audited. | P0 |
| FR-PLT-04 | A platform administrator can view non-business tenant metadata: status, branch count, user count, creation date and last activity. | P1 |

### 4.2 Tenant, branch and counter management (FR-TEN)

| ID | Requirement | Priority |
|---|---|---|
| FR-TEN-01 | The Tenant Owner maintains the tenant profile: legal name, trade name, registered address, GSTIN(s), state code, logo, and invoice header/footer text. | P0 |
| FR-TEN-02 | The Tenant Owner can create, edit and deactivate branches: code, name, address, phone, GSTIN, state code, time zone (default `Asia/Kolkata`) and invoice prefix. A deactivated branch cannot bill. Its history is retained. | P0 |
| FR-TEN-03 | The Tenant Owner or Branch Manager can create, edit and deactivate billing counters within a branch. | P0 |
| FR-TEN-04 | Tenant settings: price tax-inclusivity per product kind (OQ-11), rounding rules (OQ-08), negative-stock policy (default: disallowed; OQ-25), return window (OQ-19), discount limits per role (OQ-21), customer-detail thresholds (OQ-24) and cash-payment limit thresholds (OQ-23). | P0 |
| FR-TEN-05 | A user with more than one branch membership selects an active branch. Every branch-scoped screen and operation uses that branch, and the server re-validates it on every request. | P0 |

### 4.3 Users, roles and access (FR-USR)

| ID | Requirement | Priority |
|---|---|---|
| FR-USR-01 | The Tenant Owner invites users by email, assigns a tenant role and one or more branch memberships with a branch role. | P0 |
| FR-USR-02 | The Tenant Owner can deactivate a user's membership. The change takes effect on the user's next server request. | P0 |
| FR-USR-03 | Authorization is permission-based. System roles (`tenant_owner`, `branch_manager`, `cashier`) map to permission sets defined in the [Security Model](SECURITY_MODEL.md). Tenant-defined custom roles are a future enhancement (FUT-08). | P0 |
| FR-USR-04 | Passwords must meet the configured policy (minimum 10 characters, breached-password check where the auth provider supports it). TOTP multi-factor authentication is mandatory for Tenant Owners and Platform Administrators, and optional for other roles. | P0 |
| FR-USR-05 | The POS screen locks after a configurable idle period (default 10 minutes) and requires re-authentication. | P1 |
| FR-USR-06 | Users can reset their password through an emailed link. | P0 |
| FR-USR-07 | Every cashier and manager uses an individual account. Shared logins are not supported, because audit attribution depends on them (OQ-40). | P0 |

### 4.4 Catalogue — common (FR-CAT)

| ID | Requirement | Priority |
|---|---|---|
| FR-CAT-01 | Categories are hierarchical (maximum two levels). Each category declares a product kind (`CLOTHING`, `IMITATION_JEWELLERY`, `PRECIOUS_JEWELLERY`), a default HSN code and a default tax class. | P0 |
| FR-CAT-02 | Brands are maintained per tenant. Names are unique case-insensitively. | P0 |
| FR-CAT-03 | Users can find sellable items by name, SKU, style code, design code, barcode or tag ID. Results return in ≤ 1 s at p95 for catalogues up to 100,000 variants. | P0 |
| FR-CAT-04 | Bulk CSV import for categories, brands, products/variants, jewellery items and opening stock. Imports have a dry-run validation report, and an import either applies completely or not at all. | P0 |
| FR-CAT-05 | Records that are referenced by transactions cannot be deleted. They can only be deactivated. | P0 |
| FR-CAT-06 | Optional product/design image upload (JPEG/PNG/WebP, ≤ 2 MB each). | P2 |

### 4.5 Clothing (FR-CLO)

| ID | Requirement | Priority |
|---|---|---|
| FR-CLO-01 | A clothing product (style) has brand, category, style code (unique per tenant), name, description, HSN code and tax class. | P0 |
| FR-CLO-02 | Variants are generated from a size × colour matrix. Each variant has a SKU that is unique per tenant. A size/colour combination is unique per product. | P0 |
| FR-CLO-03 | Every sellable variant has exactly one primary barcode, unique within the tenant across all variants and jewellery items. Additional supplier/manufacturer barcodes may be attached as aliases. | P0 |
| FR-CLO-04 | Each variant has a purchase cost, a selling price and a tax class (inherited from the product unless overridden). Whether an MRP field is required separately from the selling price is OQ-12. | P0 |
| FR-CLO-05 | Stock is held per variant per branch as an integer quantity. | P0 |
| FR-CLO-06 | Product tags can be printed per variant for a chosen quantity (FR-LBL). | P0 |

### 4.6 Imitation jewellery (FR-IMJ)

| ID | Requirement | Priority |
|---|---|---|
| FR-IMJ-01 | A design master has design code (unique per tenant), category, name, HSN code, tax class and optional image. | P0 |
| FR-IMJ-02 | Every physical piece is a separate item with a unique tag ID and barcode. | P0 |
| FR-IMJ-03 | Each item has a fixed-tag selling price and a purchase cost. | P0 |
| FR-IMJ-04 | Stock is tracked per item by status (`IN_STOCK`, `SOLD`, `QC_HOLD`, `DAMAGED`, `WRITTEN_OFF`) and branch. An item that is not `IN_STOCK` cannot be sold. | P0 |
| FR-IMJ-05 | During a goods receipt or opening-stock import, a user can create N items from one design with sequential tag IDs and a common price, then edit individual items. | P0 |

### 4.7 Precious-metal jewellery (FR-PMJ)

| ID | Requirement | Priority |
|---|---|---|
| FR-PMJ-01 | Each item records: unique tag ID; design; metal type; purity; gross weight; net metal weight; zero or more stone lines (stone type, count, weight and unit, quality descriptors, certificate number, charge, whether deducted from net weight); hallmark/HUID where applicable (OQ-07); and purchase cost. | P0 |
| FR-PMJ-02 | Each item has a pricing mode: `FIXED_TAG` (stored tag price) or `METAL_RATE` (price calculated from the effective metal rate and an assigned pricing rule). | P0 |
| FR-PMJ-03 | Weights are validated: gross > 0, 0 < net ≤ gross. Unit and precision follow OQ-04 (proposed: grams, 3 decimal places). | P0 |
| FR-PMJ-04 | Attributes that affect price (weights, purity, stones, pricing mode, tag price, pricing rule) cannot be edited once an item is sold. Edits before sale require the `product.edit` permission and are audited with before/after values. | P0 |
| FR-PMJ-05 | Each item has a history timeline: receipt, edits, label prints, sale (with price snapshot), return and status changes. | P1 |

### 4.8 Jewellery pricing (FR-PRC)

| ID | Requirement | Priority |
|---|---|---|
| FR-PRC-01 | Authorized users record metal rates per metal type and purity, with an effective-from timestamp, source note and entering user. Rates are never edited or deleted; a correction is a new rate record. Rate unit and entry convention follow OQ-02 and OQ-05. | P0 |
| FR-PRC-02 | Metal-rate pricing rules are configured as data, not code. A rule is an ordered set of components drawn from a closed list (metal value, wastage, making charge, stone charge, hallmarking charge, other fixed charge), each with a basis (per gram of net or gross weight, percentage of metal value, flat per item, sum of item stone charges), value, optional min/max and tax treatment. Rules are versioned. Only a Tenant Owner can activate a version. | P0 |
| FR-PRC-03 | When a metal-rate item is scanned, the POS displays a price breakdown (weights, rate, each component, tax, total). The invoice shows the breakdown fields required by OQ-12. | P0 |
| FR-PRC-04 | At sale, the invoice line stores an immutable snapshot of the rate record, rate value, purity, weights, stone lines, pricing rule ID and version, and every component amount. | P0 |
| FR-PRC-05 | If the effective rate or rule changes between quotation and checkout, checkout is rejected with `PRICE_STALE`, and the cashier must re-quote before completing. | P0 |
| FR-PRC-06 | A `METAL_RATE` item cannot be sold when no rate for its metal and purity is effective for the current business date. The staleness rule is OQ-02. | P0 |
| FR-PRC-07 | **No pricing formula is hard-coded.** Production go-live requires the Tenant Owner to approve a configured rule set with at least five worked examples that the system reproduces to the paisa (OQ-01). | P0 |
| FR-PRC-08 | Rounding of component amounts, line totals and invoice totals follows tenant configuration (OQ-08). | P0 |
| FR-PRC-09 | Fixed-tag pricing is available for precious items regardless of rule configuration. | P0 |

### 4.9 Barcodes and scanning (FR-BAR)

| ID | Requirement | Priority |
|---|---|---|
| FR-BAR-01 | The system generates barcode values for variants and jewellery items, rendered as Code 128 by default (D-05, OQ-14). Values are unique per tenant. | P0 |
| FR-BAR-02 | Existing manufacturer/supplier barcodes (EAN-13, UPC-A, Code 128) can be registered as aliases. EAN/UPC check digits are validated. | P0 |
| FR-BAR-03 | USB and Bluetooth handheld scanners in HID keyboard mode work on the POS, receiving, label, return and stock-enquiry screens without the user first clicking an input. | P0 |
| FR-BAR-04 | Phone-camera scanning works on supported browsers (Chrome on Android; Safari on iOS 17+), using the native BarcodeDetector API where available and a WebAssembly decoder otherwise. Camera access requires HTTPS and user permission. | P0 |
| FR-BAR-05 | Manual code entry and text search are always available as a fallback when a scanner or camera fails. | P0 |
| FR-BAR-06 | Scanning gives distinct audible and visual feedback for each outcome: added, unknown code, inactive item, item already sold or not in this branch, item already in cart, and insufficient stock. | P0 |

### 4.10 Labels (FR-LBL)

| ID | Requirement | Priority |
|---|---|---|
| FR-LBL-01 | Label templates per product kind (clothing tag, jewellery tag) with configurable dimensions in millimetres, gap, orientation and fields (name, SKU/tag ID, size, colour, price, weights, purity, barcode, tenant name). Defaults depend on OQ-15. | P0 |
| FR-LBL-02 | Labels can be printed from a product, a goods receipt, a jewellery item list or a search selection, with a quantity per variant. | P0 |
| FR-LBL-03 | A true-size preview and a calibration test print are available. | P0 |
| FR-LBL-04 | Each label print batch is logged (user, time, items, quantities). | P1 |
| FR-LBL-05 | Metal-rate items print weights and purity but not a calculated price on the label, because the price varies with the rate (unless OQ-15 decides otherwise). | P0 |

### 4.11 Billing / POS (FR-POS)

| ID | Requirement | Priority |
|---|---|---|
| FR-POS-01 | Billing requires an open cash session for the counter (FR-CSH-01). | P0 |
| FR-POS-02 | One cart accepts clothing variants, imitation jewellery items and precious jewellery items together. | P0 |
| FR-POS-03 | Scanning a variant adds it or increments its quantity. Scanning a jewellery item adds it once; scanning it again is rejected. | P0 |
| FR-POS-04 | Line-level and invoice-level discounts (percentage or amount) are allowed within the role's configured limit, with a mandatory reason. A higher discount requires a manager's approval (manager re-authentication on the counter). | P0 |
| FR-POS-05 | Customer details (name, phone, GSTIN, address, state) are optional or mandatory according to configured thresholds and the customer type (OQ-24, OQ-12). | P0 |
| FR-POS-06 | The server calculates line totals, tax breakdown (CGST/SGST or IGST by place of supply), round-off and grand total authoritatively. The client display is never trusted for amounts. | P0 |
| FR-POS-07 | Checkout is atomic. Invoice, lines, price snapshots, payments, stock decrements, jewellery status changes and invoice number allocation all succeed together or none of them happen. | P0 |
| FR-POS-08 | Duplicate-sale prevention: each checkout carries an idempotency key, and retries or double-submits return the original invoice without creating a second one. | P0 |
| FR-POS-09 | Invoice numbers are gapless and consecutive per branch per financial year, in the format agreed under OQ-12 (max 16 characters). | P0 |
| FR-POS-10 | The in-progress cart survives a page refresh on the same device (local draft). This is not offline billing: checkout always requires connectivity. | P1 |
| FR-POS-11 | Core billing can be operated by keyboard alone (scan, quantity, discount, pay, print). | P1 |
| FR-POS-12 | If connectivity is lost, the POS shows a clear offline banner, disables checkout, keeps the cart, and on reconnection retries any pending checkout with the same idempotency key. | P0 |
| FR-POS-13 | A bill must have a total payable above ₹0.00. A bill whose discounts reduce the total to zero is refused. *(Added 2026-10-10, pending client acknowledgement; see Amendment log.)* | P0 |

### 4.12 Payments (FR-PAY)

| ID | Requirement | Priority |
|---|---|---|
| FR-PAY-01 | Payments are recorded manually as `CASH`, `UPI` or `CARD`. UPI and card payments capture a reference (UPI transaction reference/RRN, card approval code and last four digits). Whether references are mandatory is OQ-22. | P0 |
| FR-PAY-02 | Split payments across any combination of methods. The sum of applied payment amounts must equal the invoice grand total exactly. | P0 |
| FR-PAY-03 | For cash, the tendered amount is recorded and change is calculated. Tendered must be ≥ the applied cash amount. | P0 |
| FR-PAY-04 | For each non-cash payment, the cashier must explicitly confirm that the payment succeeded on the external terminal or app. A failed, declined or unconfirmed payment is never recorded as received, and no invoice is created until full payment is recorded. | P0 |
| FR-PAY-05 | A manager can correct the payment method of an invoice while its cash session is open, for example a payment recorded as UPI that was actually cash. The correction is recorded as a reversal plus a new entry, with a reason, and is audited. | P0 |
| FR-PAY-06 | Configurable cash-acceptance threshold per invoice with warn/block behaviour, and PAN capture above a configurable threshold (OQ-23). No legal values are hard-coded. | P0 |
| FR-PAY-07 | Credit (pay-later) sales, gift vouchers and store credit are not supported at launch (§15). | — |

### 4.13 Invoices and receipts (FR-INV)

| ID | Requirement | Priority |
|---|---|---|
| FR-INV-01 | Each invoice contains the fields required by the agreed invoice specification (OQ-12): seller details and GSTIN, invoice number and date, customer details where required, line description, HSN, quantity, unit price, discount, taxable value, tax rate and amounts, round-off, total, payment summary and terms. | P0 |
| FR-INV-02 | Thermal receipt printing at 80 mm (58 mm optional) through the browser print pipeline. | P0 |
| FR-INV-03 | A4 invoice layout (useful for jewellery and B2B customers) through the browser print pipeline, which also allows saving as PDF. | P1 |
| FR-INV-04 | Reprints are labelled "DUPLICATE" (wording per OQ-12), require the `sale.view` permission and are logged. | P0 |
| FR-INV-05 | Void: an invoice may be voided only on the same business day, while its cash session is open, by a user with `sale.void`, with a mandatory reason. Voiding reverses stock and payments, keeps the invoice number with status `VOIDED`, and is audited. The window is OQ-34. | P0 |
| FR-INV-06 | Issued invoices are immutable. Corrections after the void window go through returns and credit notes. | P0 |
| FR-INV-07 | A failed receipt print never affects the saved invoice. The UI shows "Invoice saved — print failed" with a reprint action. | P0 |
| FR-INV-08 | Receipts carry a scannable invoice barcode or QR code (invoice number) to speed up returns lookup. | P1 |

### 4.14 Returns, exchanges and corrections (FR-RET)

| ID | Requirement | Priority |
|---|---|---|
| FR-RET-01 | Returns are always against an original invoice, found by invoice number, receipt barcode or date/customer search. | P0 |
| FR-RET-02 | Partial returns are allowed. The returned quantity per line cannot exceed the sold quantity minus quantities already returned. | P0 |
| FR-RET-03 | Each return issues a credit note with its own gapless number series per branch per financial year (OQ-13). | P0 |
| FR-RET-04 | Refunds are recorded manually as cash, UPI or card and cannot exceed the credit note value. The allowed refund methods follow OQ-19. | P0 |
| FR-RET-05 | Each returned line has a disposition: `RESTOCK` (back to sellable stock), `QC_HOLD` (not sellable until released) or `DAMAGED`. | P0 |
| FR-RET-06 | An exchange performs the return and a new sale in one atomic transaction, with net settlement: the customer pays the difference, or receives a refund up to the credit note value. | P0 |
| FR-RET-07 | The return window, non-returnable categories and approval requirements are configurable. Returns outside policy require manager approval (OQ-19). | P0 |
| FR-RET-08 | The refund value of a returned precious-metal item defaults to the original invoice line value. Any other valuation (current rate, deductions) requires the policy decision in OQ-20 and is not implemented until then. | P0 |

### 4.15 Purchases and suppliers (FR-PUR)

| ID | Requirement | Priority |
|---|---|---|
| FR-PUR-01 | Supplier master: name, GSTIN, state, contact details, active flag. | P0 |
| FR-PUR-02 | A goods receipt (GRN) is created as a draft and then posted. Posting atomically increases variant stock and/or creates jewellery items in `IN_STOCK`, writes ledger movements and assigns a GRN number. | P0 |
| FR-PUR-03 | A goods receipt captures supplier invoice number and date, line costs and input-tax amounts for reporting. | P0 |
| FR-PUR-04 | A posted receipt can be cancelled by a manager only if none of its stock has been consumed. Cancellation writes reversing movements. | P1 |
| FR-PUR-05 | After posting a goods receipt, the user is offered label printing for all of its lines. | P0 |

### 4.16 Inventory (FR-STK)

| ID | Requirement | Priority |
|---|---|---|
| FR-STK-01 | Every stock change is an append-only ledger movement with type, quantity, reference document, user and time. Balances always equal the sum of movements. | P0 |
| FR-STK-02 | Opening stock is loaded through import (FR-CAT-04) as `OPENING` movements on an agreed cut-over date (OQ-30). | P0 |
| FR-STK-03 | Stock adjustments (increase/decrease) have a reason code (count correction, damage, loss/theft, found, other) and a note. Adjustments created by users without `inventory.adjust` stay pending until approved. | P0 |
| FR-STK-04 | Stock enquiry by branch, product, variant, design and item status, with movement history. | P0 |
| FR-STK-05 | Negative stock is blocked by default. If OQ-25 allows it, it is permitted only with manager override and is reported. | P0 |
| FR-STK-06 | Variant reorder level, with a low-stock list on the dashboard. | P2 |

### 4.17 Cash sessions and reconciliation (FR-CSH)

| ID | Requirement | Priority |
|---|---|---|
| FR-CSH-01 | A cash session is opened per counter with an opening float. Only one session can be open per counter at a time. The session model for multiple cashiers sharing a counter follows OQ-27. | P0 |
| FR-CSH-02 | Cash pay-ins and pay-outs (for example petty expenses) are recorded with a reason during an open session. | P0 |
| FR-CSH-03 | Closing a session requires a counted cash amount (denomination entry optional). The system computes expected cash, which is opening float + cash sales − cash refunds + pay-ins − pay-outs, and the variance. A variance above the configured threshold requires manager sign-off (OQ-22). | P0 |
| FR-CSH-04 | A printable session close report (Z-report) shows totals per payment method, invoice count, voids, returns, pay-ins/outs and variance. | P0 |
| FR-CSH-05 | UPI and card totals per session are listed with references, so they can be matched manually against bank or terminal settlement reports (OQ-22). | P0 |

### 4.18 Reports, dashboard and export (FR-RPT)

| ID | Requirement | Priority |
|---|---|---|
| FR-RPT-01 | Dashboard for the active branch (or all branches for owners): today's sales, invoice count, average bill, payment mix, top items, returns, open cash session status and low stock. | P0 |
| FR-RPT-02 | Sales register filtered by date range, branch, counter, cashier, category and product kind. | P0 |
| FR-RPT-03 | Payment summary by method and date, including refunds and corrections. | P0 |
| FR-RPT-04 | Tax summary by tax rate and HSN, separating intra-state and inter-state, and including credit notes, as GST filing support data. Filing itself is out of scope. | P0 |
| FR-RPT-05 | Stock on hand and stock valuation at cost per branch (requires `cost.view`). | P0 |
| FR-RPT-06 | Inventory movement ledger per item or variant with running balance. | P0 |
| FR-RPT-07 | Jewellery item register: tag ID, design, metal, purity, weights, status and branch, with totals of gross and net weight by status. | P0 |
| FR-RPT-08 | Returns and credit-note report. | P0 |
| FR-RPT-09 | Purchase report by supplier and period. | P1 |
| FR-RPT-10 | Cash session history and variance report. | P0 |
| FR-RPT-11 | Every report can be exported as CSV. Exports require `report.export` and are audited. | P0 |
| FR-RPT-12 | Metal rate history report. | P1 |

### 4.19 Audit (FR-AUD)

| ID | Requirement | Priority |
|---|---|---|
| FR-AUD-01 | Security events (sign-in, MFA, membership changes, support access), master-data changes (prices, costs, tax, pricing rules, metal rates), and financial events (checkout, void, return, exchange, refund, payment correction, cash session close, adjustment approval) are audit-logged with actor, time, branch, entity, before/after values and reason. | P0 |
| FR-AUD-02 | The audit log is append-only: no user, including the Tenant Owner, can edit or delete entries. The owner can filter it by date, user, action and entity. | P0 |
| FR-AUD-03 | Retention follows OQ-33. Until that is decided, entries are retained for the life of the subscription. | P0 |

---

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Security / isolation | Tenant and branch isolation is enforced in the application server and in PostgreSQL RLS. The automated negative-authorization suite (cross-tenant, cross-branch, revoked membership, suspended tenant, role escalation) must pass at 100% before each release. |
| NFR-02 | Performance | Barcode resolution server time p95 ≤ 300 ms. Scan-to-cart-line on the counter p95 ≤ 700 ms. Checkout p95 ≤ 2 s for ≤ 30 lines. Reports over 12 months of data for one branch p95 ≤ 5 s. Initial POS load (LCP) ≤ 2.5 s on the counter PC over broadband. Measured in the Mumbai region. |
| NFR-03 | Availability | Target ≥ 99.5% monthly during store hours, dependent on the hosting providers' own availability (no stronger guarantee than the providers offer). |
| NFR-04 | Durability | RPO ≤ 24 h with daily backups. RPO ≤ 5 min if the point-in-time-recovery add-on is approved (D-08). RTO ≤ 4 h. Restore is rehearsed before go-live. |
| NFR-05 | Compatibility | Counter: latest two versions of Chrome or Edge on Windows 10/11. Mobile camera scanning: Chrome on Android 10+, Safari on iOS 17+. Minimum counter resolution 1366 × 768. |
| NFR-06 | Accessibility | Core flows (sign-in, POS, payment, returns, label printing) meet WCAG 2.2 AA: keyboard operable, visible focus, 4.5:1 contrast, labelled controls, status changes announced. |
| NFR-07 | Localization | English UI. INR currency with Indian digit grouping (₹1,23,456.78). Dates `DD-MM-YYYY`. Branch-local time zone. Financial year April–March (OQ-36). Additional languages are future (FUT-09). |
| NFR-08 | Auditability | Every financial state change is traceable to a user, time, device context and reason (FR-AUD). |
| NFR-09 | Maintainability | TypeScript strict mode. Zero lint errors. ≥ 90% line coverage for pricing, tax, checkout, returns and inventory modules, including the database functions. ≥ 70% overall. Every migration is reversible by a forward fix and recorded. |
| NFR-10 | Privacy | Collect the minimum customer personal data. Purpose limitation and consent text per OQ-24, aligned with India's Digital Personal Data Protection Act, 2023. Personal data is excluded from logs. |
| NFR-11 | Scalability | Architecture supports many tenants and branches without code change. Launch sizing: 1 tenant, 1 branch, 1 counter, ≤ 15 users, ≤ 100,000 variants, ≤ 50,000 jewellery items, ≤ 2,000 invoices/day (OQ-31). |
| NFR-12 | Observability | Errors captured with request correlation IDs. Health endpoint monitored externally. Alerts for checkout error-rate spikes and database saturation. |
| NFR-13 | Data residency | Primary database and storage hosted in an India region (Mumbai), subject to D-02. |
| NFR-14 | Integrity | Money stored as exact decimals (never floating point). Weights to 3 decimal places. All amounts reproducible from the stored snapshots. |

---

## 6. User journeys and workflows

Each journey names the requirements it exercises.

### UJ-01 Tenant onboarding (Platform Admin → Owner)
1. Platform Admin creates tenant "NR Collections" and invites the owner (FR-PLT-01).
2. The owner accepts the invite, sets a password, enrols TOTP MFA (FR-USR-04).
3. The owner completes the tenant profile and GSTIN, creates the branch and counter, configures tax classes, settings and label templates (FR-TEN-01..04, FR-LBL-01).
4. The owner invites the branch manager and cashiers (FR-USR-01).

### UJ-02 Catalogue set-up and opening stock
1. The owner or manager creates categories, brands, sizes and colours (FR-CAT-01..02).
2. The manager imports products and variants and jewellery items through CSV dry-run, fixes errors, then applies the import (FR-CAT-04).
3. Opening stock is imported on the cut-over date (FR-STK-02).
4. Labels are printed for items without existing tags (FR-LBL-02).

### UJ-03 Daily start
1. The owner (or permitted manager) records today's metal rates (FR-PRC-01).
2. The cashier opens a cash session with the float (FR-CSH-01).

### UJ-04 Mixed-cart sale with split payment
1. The cashier scans two clothing variants; the second scan of the same barcode increments quantity (FR-POS-03).
2. The cashier scans a 22K gold chain (`METAL_RATE`). The POS shows the price breakdown using today's rate (FR-PRC-03).
3. The cashier scans an imitation necklace (fixed tag).
4. The cashier applies a 5% line discount on clothing within their limit and selects a reason (FR-POS-04).
5. The cashier enters customer details if the threshold requires them (FR-POS-05).
6. Payment is ₹X by UPI (reference captured, cashier confirms "received") and the balance in cash with change calculated (FR-PAY-01..04).
7. Checkout commits atomically, the invoice number is allocated and the receipt prints (FR-POS-07..09, FR-INV-02).

### UJ-05 Duplicate-click and network retry
1. The cashier double-clicks "Complete". Both requests carry the same idempotency key, and one invoice results (FR-POS-08).
2. The network drops after submit. The POS shows "Checking…", retries with the same key, and shows the saved invoice (FR-POS-12).

### UJ-06 Return and exchange
1. The customer returns a shirt within the window. The cashier scans the receipt barcode, selects the line, chooses the disposition `RESTOCK` and a reason (FR-RET-01..05).
2. If policy requires approval, the manager approves on the counter (FR-RET-07).
3. A credit note is issued and the refund is recorded in cash (FR-RET-03..04).
4. Exchange variant: the customer takes a different size. Return and new sale commit together and the difference is settled (FR-RET-06).

### UJ-07 Goods receipt with labels
1. The manager creates a goods receipt for a supplier, adds clothing variants with quantities and costs, and adds 20 imitation earrings from one design and 3 gold rings with weights (FR-PUR-02, FR-IMJ-05, FR-PMJ-01).
2. The manager posts the receipt. Stock and items are created atomically (FR-PUR-02).
3. The manager prints labels for the whole receipt (FR-PUR-05).

### UJ-08 Void within the same day
1. A mistaken invoice is found before session close. The manager voids it with a reason (FR-INV-05). Stock and payments are reversed and the event is audited.

### UJ-09 Day close
1. The cashier counts the cash and enters the count. The system shows expected cash and the variance (FR-CSH-03).
2. If the variance exceeds the threshold, the manager signs off. The Z-report prints (FR-CSH-04).
3. The manager matches UPI and card totals with settlement reports (FR-CSH-05).

### UJ-10 Owner review
1. The owner reviews the dashboard, sales register, tax summary and stock valuation, and exports CSV for their accountant (FR-RPT-*).

---

## 7. Catalogue model summary

| Kind | Master | Sellable unit | Stock unit | Barcode | Price source |
|---|---|---|---|---|---|
| Clothing | Product (style) | Variant (size × colour) | Integer quantity per variant per branch | One primary per variant + aliases | Variant selling price |
| Imitation jewellery | Jewellery design | Jewellery item (one physical piece) | Item status + branch | One per item | Item tag price |
| Precious jewellery | Jewellery design | Jewellery item | Item status + branch | One per item | Item tag price (`FIXED_TAG`) or rule + rate (`METAL_RATE`) |

---

## 8. Precious-metal pricing — product requirements

1. Two modes are selectable **per item**: `FIXED_TAG` and `METAL_RATE` (FR-PMJ-02).
2. Metal-rate pricing uses **client-configured, versioned rules** (FR-PRC-02). The platform supplies a library of component types, and the client decides which components apply, their order, bases and values.
3. Rates are effective-dated and immutable (FR-PRC-01). Each sale snapshots the rate and rule version used (FR-PRC-04).
4. The product does **not** prescribe a universal formula. An illustrative structure (for explanation only, **not** an approved formula) might be: metal value from weight × rate, plus a making charge, plus stone charges, then tax. The actual components, weight basis, wastage treatment, rounding and tax treatment are open questions OQ-01 to OQ-08 and OQ-10.
5. Go-live gate: the owner signs off a set of worked examples that the system reproduces exactly (FR-PRC-07).

---

## 9. Barcode, scanning and printing — product requirements

- **Symbologies:** Code 128 for system-generated codes. EAN-13/UPC-A and Code 128 accepted as aliases. A QR code is used for the invoice number on receipts (FR-INV-08).
- **Handheld scanners:** HID keyboard-wedge mode, with suffix Enter (configurable). Exact models are in OQ-17.
- **Phone camera:** progressive enhancement. If unsupported or denied, the user is directed to manual entry (FR-BAR-04, FR-BAR-05).
- **Labels:** browser-printed at exact millimetre sizes through the label printer's OS driver. Direct raw printer languages (ZPL/TSPL) via a local agent are future work (FUT-06).
- **Receipts:** browser-printed through the thermal printer's OS driver. The counter browser may be configured for silent kiosk printing (see [Deployment Runbook](DEPLOYMENT_RUNBOOK.md)). Cash-drawer kick depends on printer driver support (OQ-16).

---

## 10. Tenant and branch management — product requirements

- Data belongs to a tenant. Branch-scoped data (stock, sales, cash sessions, goods receipts, adjustments) also belongs to a branch.
- Master data (catalogue, prices, tax classes, pricing rules, metal rates) is tenant-wide at launch. Branch-specific prices and rates are future (FUT-07, OQ-37).
- A Tenant Owner implicitly has access to all branches of their tenant. Other users see only branches where they have an active membership.

---

## 11. Reporting and cash reconciliation — summary

See FR-RPT and FR-CSH. Reports are read-only views over the ledger and invoices. They never hold their own copies of financial truth, so each report total reconciles exactly with the underlying invoices, payments and movements (tested by TC-RPT-01).

---

## 12. Hosting, support and initial deployment scope

| Item | Launch scope |
|---|---|
| Environments | Production, staging and local development (see [TRD](TRD.md) §15). |
| Initial deployment | 1 tenant (NR Collections), 1 branch, 1 counter. |
| Hosting providers | Proposed: Vercel (application) and Supabase (Auth, PostgreSQL, Storage), India/Mumbai region where available (D-02). Account ownership is OQ-28. |
| Included hosting period | Proposed: three months starting from production go-live **and** written acceptance (OQ-28). |
| Hosting limits | Defined in §14 and finalized in the commercial proposal; not invented here. |
| Support | Proposed support model in §14.2, pending agreement (OQ-29). |
| Data migration | One import of master data and opening stock from client-provided spreadsheets in the agreed template (OQ-30). |
| Training | Up to two sessions: owner/manager and cashiers. Plus a written user guide. |

---

## 13. Future phases (not in Release 1.0)

| ID | Feature | Notes |
|---|---|---|
| FUT-01 | Branch-to-branch stock transfers | Schema designed (see [Database Design](DATABASE_DESIGN.md) §11) but not migrated or implemented at launch. Phase 10. |
| FUT-02 | Direct payment-gateway / terminal integration (UPI intent/QR with callback, card terminal APIs) | Phase 10. Provider chosen later. |
| FUT-03 | Offline billing with later synchronization | Phase 10. Requires conflict-safe invoice numbering and jewellery reservation design. |
| FUT-04 | Automatic metal-rate feed | Requires a licensed rate source agreed with the client. |
| FUT-05 | Old-gold exchange / buy-back, repairs, custom orders, gold saving schemes | Common in jewellery retail. Needs separate requirements (OQ-35). |
| FUT-06 | Local print agent for raw ZPL/TSPL/ESC-POS printing and cash drawer | Improves label precision and silent printing. |
| FUT-07 | Branch-level price and metal-rate overrides | |
| FUT-08 | Tenant-defined custom roles | The permission model already supports it. |
| FUT-09 | Additional UI languages | |
| FUT-10 | GST e-invoice (IRN) and e-way bill integration | Only if the client's turnover and B2B profile require it. |
| FUT-11 | Customer loyalty, SMS/WhatsApp receipts | |
| FUT-12 | Purchase orders, supplier returns, supplier payments | |
| FUT-13 | Cycle counting / stock-take module | Launch uses adjustments. |
| FUT-14 | Park/recall multiple carts, credit sales, gift vouchers, store credit | |
| FUT-15 | Accounting export (for example Tally) | |
| FUT-16 | Weighing-scale integration for jewellery receiving | |

## 14. Commercial and operational scope (to be agreed)

### 14.1 Hosting limits to be stated in the proposal

The proposal must state each of the following explicitly. Values marked TBD are **not** decided by this document:

| Limit | Proposed launch value | Status |
|---|---|---|
| Tenants | 1 (NR Collections) | Confirmed |
| Branches | 1 | Confirmed |
| Counters | 1 | Confirmed |
| Named users | TBD (suggest ≤ 15) | OQ-28 |
| Database size, file storage, bandwidth | Within the selected provider plans' included quotas; exact figures copied from provider pricing at procurement | OQ-28 |
| Product/design images | TBD (suggest ≤ 1 GB total) | OQ-28 |
| Third-party costs (hosting plans, PITR add-on, SMTP, error monitoring, domain) | Listed separately with who pays | OQ-28 |
| Renewal after included period | TBD | OQ-28 |

### 14.2 Proposed support model (pending agreement — OQ-29)

| Severity | Definition | Proposed first response (business hours) |
|---|---|---|
| S1 | Billing unavailable for all users / data integrity risk | TBD |
| S2 | Major function degraded, workaround exists | TBD |
| S3 | Minor defect | TBD |
| S4 | Question / enhancement request | TBD |

No final development price or recurring subscription price is set in this document.

## 15. Exclusions (Release 1.0)

Offline billing; payment-gateway or terminal integration; branch transfers; credit/pay-later sales; gift vouchers and store credit; old-gold exchange and buy-back; repairs and custom orders; savings schemes; GST return filing, e-invoice (IRN) and e-way bills; accounting ledgers and supplier payments; purchase orders and supplier returns; loyalty and marketing messaging; e-commerce; native mobile apps; multi-currency; fractional-quantity (for example per-metre) selling; RFID; weighing-scale integration; automatic metal-rate feeds.

## 16. User acceptance criteria (summary)

The detailed, measurable criteria are in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md). UAT passes when:

1. Every P0 acceptance criterion passes on staging with NR Collections' real master data sample.
2. UAT scripts UAT-01 to UAT-12 in the [Test Strategy](TEST_STRATEGY.md) are executed by NR Collections staff on the store's own hardware, with no open S1/S2 defects.
3. The owner signs off the pricing worked examples (FR-PRC-07), invoice format (OQ-12) and label layouts (OQ-15).
4. The backup restore drill has been completed and recorded.

## 17. Unresolved business decisions

Listed in full, with owners and blocking phases, in [ASSUMPTIONS_AND_OPEN_QUESTIONS.md](ASSUMPTIONS_AND_OPEN_QUESTIONS.md). Go-live-blocking items include: pricing formula and rate conventions (OQ-01..08), GST registration type and tax rates (OQ-09..11), invoice/credit-note format (OQ-12..13), label sizes and printer/scanner models (OQ-14..17), return/refund policy (OQ-19..20), cash and payment reconciliation rules (OQ-22..23) and hosting/support terms (OQ-28..29).

---

## 18. Amendment log

Nothing in the baseline above has been approved by the client yet, so these are **proposed changes made while the drafts were still open**. Each is additive or a tightening. None removes a requirement. They need the client's acknowledgement together with the rest of the baseline.

| Date | Ref | Change | Reason |
|---|---|---|---|
| 2026-10-10 | FR-POS-04 | Clarified: discounts are **denied by default**. Only the Tenant Owner is unrestricted. Branch managers and cashiers get no discount authority until the client decides the limits (OQ-21). Authority is enforced in the billing engine on the server, not only in the interface. | The brief requires authorised discounts and no unauthorised price changes; guessing limits would invent a business rule |
| 2026-10-10 | FR-POS-13 (new) | Bills with a zero or negative total are refused. | Prevents free or invalid invoices created through discounts |
| 2026-10-10 | FR-POS-01, FR-POS-05, FR-RPT-01, navigation | Interface simplified as set out in [UX_SIMPLIFICATION_PLAN.md](UX_SIMPLIFICATION_PLAN.md) §9: five workspaces, inline day-start, collapsed optional customer details, a numbers-first reports list instead of a dashboard. Capabilities and safeguards are unchanged. | Product direction: extreme simplicity |
| 2026-10-10 | FR-BAR-03/06, FR-CAT-03 | Stated explicitly: barcodes and tag codes are matched **exactly**; text search never matches them partially. | Prevents selling the wrong unique item |
| 2026-10-10 | FR-PAY-04 | Stated explicitly: UPI and card payments are recorded only after the cashier confirms receipt; an unconfirmed payment creates no invoice. | Avoids recording unreceived money |
