# NexVelt RetailOS — API / Server-Action Specification

| Field | Value |
|---|---|
| Document ID | NXR-API |
| Version | 0.2 |
| Date | 2026-10-10 |
| Related | [TRD](TRD.md) §5, §9, §12 · [Database Design](DATABASE_DESIGN.md) · [Security Model](SECURITY_MODEL.md) |

**Implementation status legend:** `Demo` = implemented on the in-memory demo engine in `src/server/billing/actions.ts` (rules unit-tested; **not** database-backed). `Spec` = specified only, not built. Nothing here is marked "production" because no database-backed contract exists yet.

---

## 1. Conventions

### 1.1 Transport
Mutations are **Next.js Server Actions** (POST, same-origin, Next.js origin checks). Reads for pages are Server Components. Downloads (CSV, print documents) are Route Handlers using the same guards. The browser never calls Supabase tables directly for business data, and never holds a secret.

### 1.2 Calling pattern (every contract)
1. **Authenticate:** verified JWT (`getClaims()`/`getUser()`), not the unverified cookie session.
2. **Resolve scope:** tenant and branch are derived **server-side** from the route and memberships. They are never trusted from the request body.
3. **Authorise (first gate):** `requirePermission(permission, scope)` in the action.
4. **Validate:** a **strict** Zod schema. Unknown keys are rejected, not ignored (this blocks client-supplied prices and totals).
5. **Execute:** a PostgreSQL RPC that re-checks authorisation (**final gate**) and enforces every invariant.
6. **Respond** with the envelope below. No raw database errors reach the client.

### 1.3 Result envelope
```ts
type ActionResult<T> =
  | { ok: true;  data: T }
  | { ok: false; code: ErrorCode; message?: string; fieldErrors?: Record<string,string>;
      retryable?: boolean; details?: unknown /* e.g. fresh quote on PRICE_STALE */ };
```
Messages shown to people are written in plain language with a next step (see `src/domain/errors.ts` and UX plan §7.2).

### 1.4 Money, quantity and identity rules
| Rule | Detail |
|---|---|
| Money | Integer **paise** at the application boundary (DB: `numeric(14,2)` rupees, converted exactly). Never a float. |
| Quantity | Positive integers. Jewellery quantity is always 1. |
| Prices and totals | **Never accepted from the client as truth.** `expectedTotalPaise` is a consistency check only; the server recomputes. |
| IDs | UUIDs. Barcodes are text, matched **exactly** after normalisation (trim, remove control chars, uppercase). |
| Idempotency | `idempotencyKey` (UUID v4) on every financial mutation. Same key + same payload → original result (`replayed: true`). Same key + different payload → `IDEMPOTENCY_KEY_REUSED`. A failed attempt stores nothing, so the same key may be retried. |
| Rate limiting | Per user and per action, in PostgreSQL (D-07). Exceeding it returns `RATE_LIMITED` (retryable). |

### 1.5 Error codes
| Code | Meaning | Retryable |
|---|---|---|
| `VALIDATION_ERROR` | Malformed or unknown input | No |
| `UNAUTHENTICATED` | No valid session | After sign-in |
| `FORBIDDEN` | Missing permission or out-of-scope tenant/branch | No |
| `NOT_FOUND` | Entity absent or hidden by RLS | No |
| `BARCODE_NOT_FOUND`, `ITEM_NOT_FOUND`, `ITEM_INACTIVE`, `ITEM_ALREADY_SOLD`, `ITEM_NOT_IN_BRANCH`, `ITEM_ON_HOLD`, `ALREADY_IN_CART`, `INSUFFICIENT_STOCK` | Item availability | No |
| `PRICE_STALE` | Price, rate or rule changed since the quote | After re-quote |
| `DISCOUNT_NOT_ALLOWED`, `DISCOUNT_REASON_REQUIRED` | Discount authority / reason | No |
| `TOTAL_NOT_PAYABLE` | Bill total is zero or negative | No |
| `SESSION_NOT_OPEN`, `CART_EMPTY` | Preconditions | No |
| `PAYMENT_MISMATCH`, `PAYMENT_NOT_CONFIRMED`, `CASH_TENDER_TOO_LOW` | Payment validation | No |
| `IDEMPOTENCY_KEY_REUSED` | Key used with a different payload | No |
| `RATE_NOT_AVAILABLE`, `TAX_NOT_CONFIGURED`, `RULE_NOT_CONFIGURED` | Missing configuration (blocks the sale) | No |
| `CONCURRENT_UPDATE` | Lock timeout or serialisation failure | Yes |
| `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `NETWORK` | Transient | Yes |
| `INTERNAL` | Unexpected. Also returned when no billing backend is configured (fails closed). | Maybe |

**Implemented in the demo engine:** validation, forbidden, all item-availability codes, `PRICE_STALE`, discount codes, `TOTAL_NOT_PAYABLE`, session and cart codes, payment codes, `IDEMPOTENCY_KEY_REUSED`, and `INTERNAL` for an unconfigured backend. **Specified but not built:** `UNAUTHENTICATED`, `NOT_FOUND`, `RATE_NOT_AVAILABLE`, `TAX_NOT_CONFIGURED`, `RULE_NOT_CONFIGURED`, `CONCURRENT_UPDATE` and `RATE_LIMITED` (they need the database, authentication or Phase 5).

---

## 2. Authentication and membership

| ID | Contract | Permission | Status |
|---|---|---|---|
| API-AUTH-01 | `signIn(email, password)` → session, then redirect to `/billing` | public | Spec |
| API-AUTH-02 | `signOut()` | authenticated | Spec |
| API-AUTH-03 | `requestPasswordReset(email)` — always returns success (no account enumeration) | public, rate-limited | Spec |
| API-AUTH-04 | `enrollMfa()` / `verifyMfa(code)` | authenticated | Spec |
| API-AUTH-05 | `getContext()` → `{ user, tenants[], activeTenant, branches[], activeBranch, permissions[], aal }` | authenticated | Spec |
| API-AUTH-06 | `switchBranch(branchCode)` → validates an active membership, then updates the route | authenticated | Spec |

**Validation:** email format; password ≥ 10 characters. **Failure:** `UNAUTHENTICATED`, `RATE_LIMITED` (5 attempts/15 min per account + IP). **Idempotency:** not required.
**Demo status:** none of these exist. A demo-only cookie selects the role (`nv_demo_role`); it is inert in production builds and must be removed in T2.09.

## 3. Tenant, branch and user management

| ID | Contract | Input (summary) | Permission | Failure | Status |
|---|---|---|---|---|---|
| API-TEN-01 | `createTenant` | legal/trade name, code, owner email | platform admin + aal2 | `CONFLICT` code exists | Spec |
| API-TEN-02 | `setTenantStatus` | tenantId, `ACTIVE`/`SUSPENDED`, reason | platform admin + aal2 | — | Spec |
| API-TEN-03 | `updateTenantProfile`, `updateTenantSettings` | profile / settings keys | `settings.manage` + aal2 for tax settings | `VALIDATION_ERROR` | Spec |
| API-TEN-04 | `createBranch`, `updateBranch`, `setBranchStatus` | code, name, state code, GSTIN, time zone | `branch.manage` | duplicate code | Spec |
| API-TEN-05 | `createCounter`, `updateCounter` | branchId, code, name | `branch.manage` | — | Spec |
| API-TEN-06 | `inviteUser` | email, tenant role, branch roles[] | `staff.manage` | duplicate membership | Spec |
| API-TEN-07 | `setMembershipStatus` | membershipId, status | `staff.manage` | cannot disable the last owner | Spec |
| API-TEN-08 | `grantSupportAccess` / `revokeSupportAccess` | platform admin, reason, ≤ 72 h | owner + aal2 | — | Spec |

All write an audit entry. **Idempotency:** `inviteUser` and `createTenant` use a natural key (email / code) and return the existing record on repetition.

## 4. Products, variants and jewellery

| ID | Contract | Permission | Key validation | Status |
|---|---|---|---|---|
| API-CAT-01 | `createProduct` (clothing): style, brand, category, tax class, variants[] (size, colour, price, optional cost/MRP, initial barcode) | `product.create` / `product.edit` (+`product.price_edit` for prices, `cost.manage` for costs) | category kind = `CLOTHING`; SKU unique; size×colour unique per product; price ≥ 0; MRP ≥ price | Spec |
| API-CAT-02 | `generateVariants(productId, sizes[], colours[], defaults)` | `product.create` / `product.edit` | no duplicate combinations; ≤ 500 per call | Spec |
| API-CAT-03 | `updateVariant` (price, tax class, active) | `product.price_edit` for price | optimistic version check | Spec |
| API-CAT-04 | `createJewelleryDesign` | `product.create` / `product.edit` | design code unique; kind matches category | Spec |
| API-CAT-05 | `createJewelleryItems(designId, kind, count, common fields, perItem[])` — imitation: fixed price; precious: metal, purity, gross/net weight, stones[], pricing mode, tag price or rule | `product.edit` | net ≤ gross; fixed mode needs tag price; precious needs metal + purity; weights 3 dp | Spec |
| API-CAT-06 | `updateJewelleryItem` | `product.edit` | rejected if the item is `SOLD` (price-affecting fields) | Spec |
| API-CAT-07 | `searchCatalogue(query, filters)` — **name/style/design text only; never matches barcodes or tag codes** | `catalog.view` or `sale.create` | query 2–80 chars | **Demo** (`searchItems`) |
| API-CAT-08 | `importCatalogue(file, dryRun)` | `product.create` / `product.edit` | atomic; row-level error report | Spec |

## 5. Barcode resolution

### API-BAR-01 `resolveBarcode(code)` — **Demo (as `scanBarcode`)**
| Aspect | Specification |
|---|---|
| Input | `code` string ≤ 128 chars; current cart (identities + quantities) |
| Normalisation | remove control characters, trim, uppercase. Must match `^[A-Z0-9]{4,48}$`. |
| Lookup | **Exact equality** on the normalised code within the user's tenant. **No** prefix, substring, trigram or fuzzy matching. |
| Output | The updated server-priced cart quote with the item added (clothing: +1 quantity; jewellery: once) |
| Authorisation | `sale.create`; branch from membership |
| Failures | `BARCODE_NOT_FOUND`, `ITEM_INACTIVE`, `ITEM_ALREADY_SOLD`, `ITEM_NOT_IN_BRANCH`, `ITEM_ON_HOLD`, `ALREADY_IN_CART`, `INSUFFICIENT_STOCK`, `VALIDATION_ERROR` |
| Idempotency | Not required (read-like; no state change) |
| Performance | server p95 ≤ 300 ms (NFR-02) |

### API-BAR-02 `generateBarcodes`, API-BAR-03 `addBarcodeAlias`, API-BAR-04 `renderLabelBatch(templateId, lines[])` — Spec

## 6. Pricing calculation

| ID | Contract | Status |
|---|---|---|
| API-PRC-01 | `createMetalRate(metal, purity, entered rate, unit, effectiveFrom, source)` — immutable, normalised to per-gram | Spec (blocked: OQ-02, 05) |
| API-PRC-02 | `createPricingRuleDraft`, `updateDraftComponents`, `activatePricingRule(ruleId, approvedExampleRef)` — owner + aal2; requires worked examples | Spec (blocked: OQ-01) |
| API-PRC-03 | `previewItemPrice(itemId)` → component breakdown with rate and rule snapshot | Spec |
| API-PRC-04 | `quoteCart(lines[])` → priced lines, discounts, totals, `issues[]` | **Demo** (fixed-tag and variant prices only; **tax not computed**, `taxConfigured:false`) |

### `quoteCart` (API-PRC-04)
- **Input:** `lines: { itemId, quantity, discountPaise?, discountReason? }[]` (≤ 200 lines). **No price field is accepted** (strict schema).
- **Output:** `{ lines[], itemCount, discountTotalPaise, grandTotalPaise, taxConfigured, issues[] }`. Each line has `unitPricePaise`, `grossPaise`, `discountPaise`, `lineTotalPaise`.
- **Authorisation:** `sale.create`. The caller's **discount authority comes from the server-side role**, never the request.
- **Discount rules (enforced in the engine):**
  - no discount without authority (default deny; owner unrestricted; manager and cashier zero until OQ-21);
  - `discountPaise` is an integer ≥ 0 and ≤ line gross (so no negative line total);
  - within the role limit in basis points, compared exactly with integers;
  - a non-blank reason is required whenever a discount > 0.
- **Failure:** the cart is still priced, and `issues[]` lists problems (`DISCOUNT_NOT_ALLOWED`, `INSUFFICIENT_STOCK`, …). A malformed cart returns an issue `VALIDATION_ERROR`, never an empty ₹0 cart.
- **Production (Spec):** adds metal-rate components, tax breakdown (CGST/SGST/IGST), round-off, and the `price_basis` ids (rate, rule version) used for `PRICE_STALE`.

## 7. Inventory receiving and adjustment

| ID | Contract | Permission | Validation / failure | Idempotency | Status |
|---|---|---|---|---|---|
| API-INV-01 | `createGoodsReceiptDraft`, `updateGoodsReceiptDraft` | `purchase.manage` | supplier active; duplicate supplier invoice no. | n/a | Spec |
| API-INV-02 | `postGoodsReceipt(receiptId)` — atomically adds stock/items, writes `PURCHASE_RECEIPT` movements, assigns number | `purchase.manage` | draft only; lines > 0; `CONFLICT` if already posted | **key required**; repeat returns the same receipt | Spec |
| API-INV-03 | `cancelGoodsReceipt(receiptId, reason)` | `purchase.manage` (manager) | only if no stock consumed | key required | Spec |
| API-INV-04 | `createStockAdjustment`, `postStockAdjustment` | `inventory.adjust`; approval by `inventory.adjust` | reason code; cannot drive balance below zero (unless OQ-25) | key required | Spec |
| API-INV-05 | `getStock(filters)`, `getMovements(itemId)` | `inventory.view` | branch scope | n/a | Spec |

## 8. Checkout and invoice creation

### API-POS-01 `completeCheckout(input)` — **Demo (rules)**; production = PostgreSQL `pos_checkout`
| Aspect | Specification |
|---|---|
| Input | `idempotencyKey` (UUID), `lines[]` (itemId, quantity, optional discount + reason), `payments[]`, `expectedTotalPaise`, optional `customer {name, phone}` |
| Extra fields | **Rejected.** Prices, totals and tax can't be set by the client. |
| Authorisation | `sale.create` in the branch; discount authority by role; open cash session in the branch |
| Server steps | (1) replay check by idempotency key + payload hash → (2) day started → (3) cart non-empty and well-formed → (4) re-price every line from the catalogue and re-check availability → (5) compare `expectedTotalPaise` (`PRICE_STALE`) → (6) total > 0 (`TOTAL_NOT_PAYABLE`) → (7) validate payments → (8) commit everything or nothing |
| Payment rules | method ∈ {CASH, UPI, CARD}; each amount a positive integer; Σ amounts = grand total exactly; cash tendered ≥ cash amount (change computed); UPI/card require `confirmedReceived: true`; unconfirmed payments are never recorded as received |
| Output | `{ invoiceId, invoiceNumber, issuedAt, lines[], grandTotalPaise, paidPaise, changePaise, payments[], taxConfigured, replayed }` |
| Failures | `SESSION_NOT_OPEN`, `CART_EMPTY`, item errors, `DISCOUNT_*`, `PRICE_STALE` (with fresh quote), `TOTAL_NOT_PAYABLE`, `PAYMENT_*`, `CASH_TENDER_TOO_LOW`, `IDEMPOTENCY_KEY_REUSED`, `VALIDATION_ERROR`, `FORBIDDEN` |
| Idempotency | **Required.** Replays return the original invoice with `replayed: true` and change nothing. |
| Atomicity | Demo: single synchronous step in one process. **Production: one PostgreSQL transaction (TRD §12.2).** All effects commit together or none do. |
| Production-only effects | invoice number from a gapless per-branch per-FY sequence; invoice and line **snapshots** (price components, tax, rate and rule ids); payment ledger rows; inventory movements; audit entry; row locks on serialized items and balances |

### Other contracts
| ID | Contract | Status |
|---|---|---|
| API-POS-02 | `startDay(openingFloatPaise)` / `getSession()` | **Demo** |
| API-POS-03 | `closeDay(countedCash, denominations?)` → expected, variance, Z-report; manager sign-off if the variance exceeds the threshold | Spec |
| API-POS-04 | `recordCashMovement(type, amount, reason)` | Spec |
| API-POS-05 | `getInvoice(id)`, `listInvoices(filters)`, `getReceipt(id, format)` | Spec |
| API-POS-06 | `logPrint(documentId, format, isReprint)` — reprints require `sale.view` | Spec |

## 9. Payment recording

| ID | Contract | Rules | Status |
|---|---|---|---|
| API-PAY-01 | Payments recorded inside `completeCheckout` only. There is **no** standalone "mark invoice paid" action. | A sale that is not fully paid is not created. | **Demo** |
| API-PAY-02 | `correctPaymentMethod(invoiceId, paymentId, newMethod, reason)` | manager; the invoice's cash session must be open; creates a reversal plus a new payment row; audited; key required | Spec |
| API-PAY-03 | Refund payments are created by `createReturn` | amount ≤ credit note value | Spec |

## 10. Returns, exchanges, voids and refunds

| ID | Contract | Permission | Rules | Idempotency | Status |
|---|---|---|---|---|---|
| API-RET-01 | `findInvoiceForReturn(number | barcode | search)` | `sale.view` | branch scoped | n/a | Spec |
| API-RET-02 | `createReturn(invoiceId, lines[{invoiceItemId, quantity, disposition}], reason, refunds[], approvalToken?)` | `sale.return`; approval if outside policy | Σ returned ≤ sold − already returned; disposition RESTOCK / QC_HOLD / DAMAGED; refund ≤ credit note; credit-note number gapless; jewellery refund value = original line (OQ-20) | **required** | Spec |
| API-RET-03 | `createExchange(returnLines, newLines, payments)` — one transaction | `sale.return` + `sale.create` | net settlement; same atomicity as checkout | **required** | Spec |
| API-RET-04 | `voidInvoice(invoiceId, reason, approvalToken)` | `sale.void` | same business day + cash session open (OQ-34); reverses stock and payments; number kept as `VOIDED` | **required** | Spec |
| API-RET-05 | `requestApproval(actionType, scope, managerCredentials)` → single-use token (2 min) bound to the exact request | cashier requests, manager credentials verified | token consumed by the RPC | n/a | Spec |

## 11. Reports and exports

| ID | Contract | Permission | Notes | Status |
|---|---|---|---|---|
| API-RPT-01 | `getDashboardNumbers(branch?, date)` | `report.view` | numbers only | Spec |
| API-RPT-02 | `runReport(name, params)` — names: `sales-register`, `payment-summary`, `tax-summary`, `stock-on-hand`, `stock-valuation` (needs `cost.view`), `movement-ledger`, `jewellery-register`, `returns`, `purchases`, `cash-sessions`, `metal-rates` | `report.view` | date range ≤ 366 days; branch scope enforced by RLS (`security_invoker` views) | Spec |
| API-RPT-03 | `exportReportCsv(name, params)` — streamed, row cap, audited | `report.export` | CSV-injection-safe (leading `= + - @` escaped) | Spec |

Every report must reconcile with the ledger and the invoices it summarises (TC-RPT-01).

## 12. Security-relevant behaviours of every contract
- Tenant and branch come from the verified session and membership, **never** from the request body.
- A hidden control is not security. Every action re-checks permission on the server.
- Unknown request fields are rejected.
- Errors never leak whether a row exists in another tenant (`NOT_FOUND` for both missing and forbidden rows where appropriate).
- Financial mutations write an audit entry in the same transaction.
- Logs contain identifiers and codes, not customer data, payment references or secrets.
