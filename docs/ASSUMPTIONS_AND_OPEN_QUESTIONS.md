# NexVelt RetailOS — Assumptions and Open Questions

| Field | Value |
|---|---|
| Document ID | NXR-AOQ |
| Version | 0.1 |
| Date | 2026-10-10 |
| Purpose | Separate what is **confirmed** from what is **assumed**, and list every decision that needs **NR Collections' approval**. This document does not invent answers to unresolved financial or operational rules. |

**How the software behaves while a question is open:** the data model stores the setting as *not configured*, and the feature that needs it is **blocked or defaults to the safest behaviour** (deny, require approval, or refuse to bill). Nothing below has a hidden default that could affect money.

---

## 1. Confirmed requirements (from the client brief)

| ID | Confirmed requirement |
|---|---|
| C-01 | First customer is NR Collections. It sells clothing, imitation jewellery and precious-metal jewellery. |
| C-02 | Initial deployment: one branch, one billing counter. Architecture supports many tenants, branches, counters and users. |
| C-03 | Clothing: brand, category, style, size, colour, SKU; unique barcode per sellable variant; variant-level stock; purchase cost, selling price and tax; tag printing. |
| C-04 | Imitation jewellery: design and category; unique item/tag ID and barcode; fixed-tag price; item-level stock. |
| C-05 | Precious-metal jewellery: unique tag; metal, purity, gross weight, net metal weight, stone details; two pricing modes (fixed tag, or configurable metal-rate pricing); effective-dated rates; historical price snapshots; configurable rules; **no universal formula hard-coded**. |
| C-06 | One unified cart for clothing and jewellery. Handheld USB/Bluetooth scanner and phone-camera scanning. Cash, UPI, card and split payments, recorded manually. Invoice generation, thermal receipt printing, returns, exchanges, reprints, authorised corrections. Atomic checkout and duplicate-sale prevention. |
| C-07 | Roles: platform administrator, tenant owner, branch manager, cashier. |
| C-08 | Online-only billing at launch. **No offline billing and no payment-gateway integration in the initial release.** |
| C-09 | Hosting included for an agreed initial period (proposed: three months after go-live and acceptance). Limits, support terms, renewals and third-party costs must be documented. No final development or subscription price is set. |
| C-10 | Stack: Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui, Lucide, Supabase Auth, PostgreSQL, Supabase Storage where required, Vercel or compatible hosting. |
| C-11 | Tenant and branch authorisation is enforced on the server **and** by PostgreSQL Row Level Security. Privileged database credentials never reach the browser. |
| C-12 | Product direction (UX): extreme simplicity. Five primary navigation items (Billing, Products & Stock, Sales, Reports, Settings). A cashier learns basic billing in about 10 minutes. See [UX_SIMPLIFICATION_PLAN.md](UX_SIMPLIFICATION_PLAN.md). |
| C-13 | Palette: `#00D9D9`, `#00B8B8`, `#35F5FF`, `#F8FAFC`, `#FFFFFF`, `#E5E7EB`, `#111827`, `#6B7280`. |

## 2. Assumptions (made by Nexvelt; each is revisable)

| ID | Assumption | Risk if wrong | Where it appears |
|---|---|---|---|
| A-01 | Indian retail: INR currency, GST applies, English UI, `Asia/Kolkata` time zone. | Re-work of tax/format modules | PRD NFR-07 |
| A-02 | Financial year April–March, with invoice numbers restarting each FY (confirm under OQ-36). | Invoice-series errors | DB §12.4 |
| A-03 | The counter PC runs Windows 10/11 with current Chrome or Edge. | Printing/kiosk guidance changes | TRD §14 |
| A-04 | Store has stable broadband. A mobile hotspot is a backup. | Lost billing time (online-only) | TRD R-04 |
| A-05 | At launch, master data (catalogue, prices, rates, rules, tax classes) is tenant-wide, not per branch. | Per-branch pricing needs later work (FUT-07) | PRD §10 |
| A-06 | Each cashier and manager has an individual login. | Audit attribution breaks if shared | PRD FR-USR-07 |
| A-07 | Clothing quantities are whole units (no per-metre selling). | Fractional stock redesign | PRD §15 |
| A-08 | Every jewellery piece is a single physical item with its own tag. No bulk jewellery stock lines. | Bulk-stock model needed | DB §6 |
| A-09 | A return is made at the branch that sold the item. | Cross-branch returns need transfers | DB §12.11 |
| A-10 | Stones are recorded as lines on the item (type, count, weight, charge). | Different stone model | DB §6.5 |
| A-11 | GST filing, e-invoice (IRN) and e-way bills are out of scope. The system supplies tax summary data only. | Compliance gap if the client expected filing | PRD §15 |
| A-12 | Stock valuation uses the item's recorded purchase cost (specific cost for jewellery, latest receipt cost for clothing variants). A weighted-average method is not assumed. | Valuation report differs from the accountant's | DB §5.6 |
| A-13 | Discounts are given per line and are not allowed unless the role has authority. Only the owner has unrestricted authority; managers and cashiers get **zero** until OQ-21 is decided. | Slower counters until limits are set | `src/domain/policy.ts` |
| A-14 | A bill must have a total above ₹0. Fully free bills are refused. | Rare promotional free items blocked unless another paid line exists | Engine rule `TOTAL_NOT_PAYABLE` |
| A-15 | UPI and card payments are made on the client's own terminal or UPI app, and the cashier confirms receipt manually. | Wrong cashier confirmations; reconciliation is manual (OQ-22) | PRD FR-PAY-04 |
| A-16 | Seed catalogue, prices and invoice prefix `DEMO-` in the demo build are fictitious and not NR Collections data. | None if kept out of production | `demo-data.ts` |
| A-17 | A small shop has at most about 15 users, 100,000 variants, 50,000 jewellery items and 2,000 invoices a day. | Capacity re-plan | PRD NFR-11 |
| A-18 | Supabase and Vercel are acceptable providers, in the Mumbai region (D-02). | Data-residency or latency issues | TRD §2 |
| A-19 | The package manager is npm (D-13). | None | TRD §2 |
| A-20 | Clients accept that billing stops during a full internet outage until offline billing exists (Phase 10). A paper-bill fallback procedure is provided in the runbook. | Business interruption | Runbook §10 |

## 3. Open questions requiring NR Collections' approval

**Status values:** `OPEN` = no answer yet. **Blocking** = which phase or go-live cannot be completed without it. **Interim** = what the software does until answered.

### 3.1 Precious-metal pricing

| ID | Question | Why it matters | Blocking | Interim behaviour |
|---|---|---|---|---|
| OQ-01 | What is the exact formula for metal-rate pricing (which components, in what order, on which weight)? Please give at least five worked examples with the final price. | Core financial calculation; go-live gate FR-PRC-07 | Phase 5 completion; go-live for metal-rate items | No rule exists, so metal-rate items cannot be sold. Fixed-tag mode works. |
| OQ-02 | Where does the metal rate come from, who enters it, how often, and how old may a rate be before selling is blocked? | Rate source and staleness rule | Phase 5 | Sale of a metal-rate item is blocked if there is no rate. Staleness not enforced until configured. |
| OQ-03 | Is there a licensed or preferred rate source (association rate, bullion feed) to integrate later, or is manual entry final? | Possible automatic feed (FUT-04) | None for launch | Manual entry only. |
| OQ-04 | Weight unit and precision (grams? 3 decimals?). Is gross weight measured with or without stones? | Weight validation and display | Phase 3 | Grams, 3 decimals, as proposed. |
| OQ-05 | What are the purity names and fineness values (e.g. 22K, 18K, 916, 750, silver 925), and is the rate quoted per gram, per 10 grams, or per kg? | Purity master data and rate entry | Phase 5 | No purities seeded in production. Rate unit stored with each rate. |
| OQ-06 | Which stone details must be recorded (type, count, weight in carat or gram, quality, certificate, charge)? Is stone weight deducted from net weight? | Item form and pricing | Phase 3 | All fields supported; deduction recorded per stone line. |
| OQ-07 | Is hallmark/HUID recorded per item, and is it printed on the label or invoice? | Compliance fields | Phase 3 | Optional field stored, not required. |
| OQ-08 | Rounding: per component, per line or per invoice? To the nearest ₹1, ₹0.50 or paisa? Mode (half-up, down)? | Invoice totals | Phase 5, 6 | No round-off configured; amounts shown to the paisa. |
| OQ-10 | For wastage, making and other charges, which are taxable and at what rate or treatment? (Confirm with your chartered accountant.) | Tax on jewellery | Phase 5 | Tax not configured: jewellery sale is refused with "tax not configured" once tax is enforced. |

### 3.2 Tax and invoice

| ID | Question | Blocking | Interim |
|---|---|---|---|
| OQ-09 | GST registration type (regular, composition), GSTIN(s), state, and whether each branch has a separate GSTIN. | Phase 2 settings; invoice | Fields stored; tax calculation disabled until configured. |
| OQ-11 | Are clothing and jewellery selling prices tax-inclusive or tax-exclusive? | Phase 6 | Not configured; billing requires the setting once tax is enforced. |
| OQ-12 | Exact invoice content and layout: title (Tax Invoice / Bill of Supply), mandatory fields, HSN display, invoice number format (max 16 chars), terms text, reprint wording, jewellery breakdown shown or hidden, MRP field. | Phase 6 | Neutral layout with the invoice number, lines, totals and payments. Not legally validated. |
| OQ-13 | Credit-note numbering and format for returns. | Phase 7 | Separate gapless series per branch per financial year. |
| OQ-36 | Financial year start and invoice-number reset rule. | Phase 6 | April–March assumed (A-02). |
| OQ-33 | Retention period for invoices, audit logs and personal data. | Phase 8 | Retained for the subscription lifetime. |

### 3.3 Barcodes, labels and hardware

| ID | Question | Blocking | Interim |
|---|---|---|---|
| OQ-14 | Barcode formats. Are there existing tags or supplier barcodes to keep? Preferred prefix per item type? | Phase 4 | Code 128, tenant prefix and sequence (D-05). Supplier codes stored as aliases. |
| OQ-15 | Label sizes (mm), columns, the gap between labels, and which fields to print for clothing and jewellery. Is the price printed on metal-rate labels? | Phase 4 | Configurable templates. No price on metal-rate labels. |
| OQ-16 | Label printer, receipt printer and cash-drawer models, interface, and driver. | Phase 4, 9 | Browser printing via OS driver. Drawer opens manually. |
| OQ-17 | Handheld scanner model(s), and whether each is in keyboard (HID) mode with an Enter suffix. | Phase 4, 9 | Assumed HID with an Enter suffix. |
| OQ-18 | Which phones/tablets will be used for camera scanning? | Phase 4 | Chrome on Android, Safari on iOS 17+. |

### 3.4 Sales, returns and payments

| ID | Question | Blocking | Interim |
|---|---|---|---|
| OQ-19 | Return and refund policy: window in days, non-returnable categories, refund methods (cash/UPI/card/credit note), manager approval rules. Same rules for jewellery? | Phase 7 | Every return needs manager approval. |
| OQ-20 | Refund value of returned precious-metal items: original invoice value, current rate, or with deductions? | Phase 7 | Original invoice line value only. |
| OQ-21 | Discount limits per role (percentage and amount), and which components of a jewellery price may be discounted (e.g. making charge only). | Phase 6 | Managers and cashiers cannot discount (default deny). Owner unrestricted. |
| OQ-22 | Cash/UPI/card reconciliation: are UPI and card references mandatory? What cash variance needs manager sign-off? How do you match bank/terminal settlements? | Phase 8 | References optional. Any variance needs sign-off. Manual matching from the session report. |
| OQ-23 | Cash-sale limits and PAN rules (warn or block above what amount?). | Phase 6 | No limit enforced; fields available. |
| OQ-24 | Customer data: when is a customer name/phone mandatory (thresholds, jewellery sales)? Consent wording. | Phase 6 | Walk-in sales need no customer. |
| OQ-25 | May stock go negative (e.g. when a physical count is behind)? | Phase 3 | Negative stock blocked. |
| OQ-34 | Void window: same business day with an open cash session. Do you agree? | Phase 7 | Same business day and open session. |
| OQ-38 | Can a cashier change a price at the counter? By whom and within what limits? | Phase 6 | No price override at all. Prices come from the catalogue only. |
| OQ-27 | How do multiple cashiers share a counter and a cash drawer during a day? | Phase 6 | One open session per counter, closed by whoever counts the cash. |

### 3.5 Catalogue, stock and users

| ID | Question | Blocking | Interim |
|---|---|---|---|
| OQ-26 | Who may see purchase costs and profit? | Phase 3 | Owner only (`cost.view`). |
| OQ-30 | Opening stock: source spreadsheets, cut-over date, and who signs off the totals. | Phase 9 | Import templates and a dry-run report. |
| OQ-37 | Will branches ever need different prices or metal rates? | Future | Tenant-wide. |
| OQ-39 | How often is a physical stock check done, and by whom? | Phase 7 | Stock adjustments with reasons. |
| OQ-40 | Confirm that every staff member uses an individual login. | Phase 2 | Required. |
| OQ-35 | Which jewellery workflows are needed after launch: old-gold exchange, repairs, custom orders, savings schemes? | Future | Not included. |

### 3.6 Hosting, commercial and support

| ID | Question | Blocking | Interim |
|---|---|---|---|
| OQ-28 | Who owns the hosting accounts (client or Nexvelt)? Included hosting period and start date. Limits (users, storage, bandwidth) and third-party costs (hosting plans, point-in-time recovery, email, monitoring, domain). Renewal terms. | Commercial sign-off, Phase 9 | Proposed three months from go-live and acceptance. |
| OQ-29 | Support terms: hours, response and resolution targets per severity, channels, and escalation. | Commercial sign-off | Proposed table in the PRD, values TBD. |
| OQ-31 | Expected volumes (invoices per day, number of items, users). | Phase 9 sizing | Assumption A-17. |
| OQ-32 | Internet connectivity at the store and the backup connection. | Phase 9 | Assumption A-04. |

## 4. Technical decisions needing approval (summary)

Detailed in TRD §22: D-01 stack/version policy, D-02 regions, D-03 pricing in PostgreSQL, D-04 browser printing, D-05 Code 128, D-06 path-based tenancy, D-07 database rate limiting, D-08 point-in-time recovery, D-09 error monitoring, D-10 SMTP, D-11 void window, D-12 account ownership, D-13 npm.

## 5. Decision log

| Date | Item | Decision | By |
|---|---|---|---|
| 2026-10-10 | Package manager | npm retained, TRD amended (D-13) | Engineering, pending client acknowledgement |
| 2026-10-10 | Discount authority | Default deny; owner unrestricted (A-13) | Engineering, pending OQ-21 |
| 2026-10-10 | Zero-value bills | Refused (A-14) | Engineering, pending client acknowledgement |
| 2026-10-10 | Navigation | Five workspaces | Product direction (C-12) |

No other decisions have been approved by the client yet.
