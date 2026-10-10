# NexVelt RetailOS — UX Simplification Plan

| Field | Value |
|---|---|
| Document ID | NXR-UX |
| Version | 0.1 |
| Date | 2026-10-10 |
| Status | Draft. Supplements the PRD/TRD (which are drafts, not yet approved) without rewriting them. Where this plan and the PRD differ, the **Delta table (§9)** lists each change so it can be approved explicitly. |
| Principle | **Extreme simplicity on the surface; enterprise-grade underneath.** A new cashier should learn basic billing in 10 minutes. |

## 1. Review findings: where the current spec is too complex

| # | Finding in PRD/TRD | Why it hurts | Fix |
|---|---|---|---|
| 1 | The URL/route layout (TRD §3.3) lists ~15 top-level areas (catalogue, suppliers, pricing, cash, receiving, stock, returns, labels, invoices, audit…). | Becomes a sidebar with 15 entries. | Five workspaces (§2). Everything else becomes a tab or panel inside one. |
| 2 | PRD UJ-04 asks for customer details, discount reasons and payment references on the main path. | Slows every sale. | Walk-in is the default. Customer, discount and references are collapsed under "Add details" and only forced when a configured threshold requires them. |
| 3 | Cash session is a hard gate before billing (FR-POS-01). | A cashier who opens the app at 9:58 hits a wall. | Keep the safeguard, but make it one inline step on the Billing screen ("Start day: enter opening cash"), never a separate page. |
| 4 | Product creation is one big form with kind-specific fields mixed together. | Dense; wrong fields shown. | Choose product type first; show only that type's fields (§5). |
| 5 | Barcode and text search are both on the POS (FR-BAR, FR-CAT-03) without a rule for which wins. | A partial-text match can add the wrong unique item. | One input. **Exact code match wins and adds immediately. Text search never matches a barcode partially** (§3.2). |
| 6 | Sales, returns, invoices, reprints, voids and payment corrections are separate screens. | Cashier cannot find "the bill". | One **Sales** workspace: find a bill, then act on it (reprint, return, void, correct payment). |
| 7 | Dashboards, charts and many reports (FR-RPT-01..12). | Visual noise. | Reports is a plain list of 8 reports with a date filter. The only chart is none at launch. Numbers first. |
| 8 | Settings are scattered across tenant, branch, tax, pricing, rates, labels, users, roles. | | One **Settings** workspace with a setup checklist. |

## 2. Navigation (five items, no nested menus)

| Workspace | Who sees it | Contains (tabs inside the workspace) |
|---|---|---|
| **Billing** | everyone with `sale.create` | The billing screen only. Day start / day close are inline panels. |
| **Products & Stock** | `catalog.view` and above (manager, owner) | Products · Stock · Receiving (purchases) · Labels · Adjustments |
| **Sales** | `sale.view` (cashier sees today's bills of their branch only) | Bills list → bill detail with Reprint · Return/Exchange · Void · Fix payment |
| **Reports** | `report.view` (manager, owner) | Report list with date range; CSV export |
| **Settings** | owner (managers see a small subset) | Shop & branches · People · Tax · Metal rates & pricing · Labels & printers · Audit log |

Rules:
- **Cashier:** lands directly in Billing after login. Sees Billing and Sales (today's bills). Nothing else appears. No disabled menu items, because absent permissions mean absent controls.
- **Manager/owner:** lands in Billing too (they also sell), with all five items shown by permission.
- A user with a single branch never sees a branch picker.
- Layout: left rail on desktop (icon + label), bottom tab bar on phone, five items max. No second-level menu anywhere.

## 3. Billing workspace

### 3.1 Flow
`SCAN OR SEARCH → CHECK CART → PAY → COMPLETE`, all on one screen. No modal is needed for a normal cash sale.

```
┌──────────────────────────────────────────────┬───────────────────────────┐
│ [ Scan barcode or search product…        ]   │   Total payable           │
│                                              │   ₹ 4,998.00  (very large)│
│  Item                 Qty   Price   Total    │   Items: 3                │
│  Cotton Shirt M/Blue   1  ₹1,299  ₹1,299 ✕   │                           │
│  Necklace  IJ0000123   1  ₹  499  ₹  499 ✕   │   Pay with                │
│  22K Gold Chain GJ…45  1  ₹3,200  ₹3,200 ✕   │   [ Cash ] [ UPI ] [ Card ]│
│                                              │   Split payment ▸         │
│  (empty state: "Scan an item to begin")      │   Add details ▸ (optional)│
│                                              │   [  COMPLETE BILL  F9  ] │
└──────────────────────────────────────────────┴───────────────────────────┘
```
Tablet: the same two columns when ≥ 900 px. Phone: cart first, a sticky bottom bar shows the total and a "Pay" button that opens the payment sheet.

### 3.2 Input rules (the safeguard against wrong-item sales)
1. **One input.** It is focused on load, after every add, after closing any dialog, and after a sale completes. A global key listener catches scanner bursts when focus is elsewhere (but never steals focus from another text field).
2. **Scanner burst** (≥ 4 chars within 35 ms per key, ended by Enter) or a typed value followed by Enter is first tried as an **exact barcode / tag-code match** (case-insensitive, trimmed, normalised). An exact match is added to the cart immediately with no extra click.
3. **Barcodes are never matched partially.** There is no `LIKE`/trigram path for a code that looks like a barcode. A near-miss shows "Barcode not found" (never a guess).
4. **Text search** (name/SKU/style/design) only runs for non-exact input, shows results in a list, and requires a click or ↑↓ + Enter to choose. Typing more than 3 characters opens the list. If a variant has several sizes/colours, the list shows one row per variant.
5. Scanning the same clothing barcode again increases quantity. Scanning a unique jewellery tag twice is rejected with "This item is already in the cart."
6. An item that is sold, on hold, in a different branch or inactive gives a specific message (see §7.2), not a generic failure.

### 3.3 Payment
- Default selected method is **Cash**. For cash, a numeric field "Customer gives" (auto-focus, Enter to complete) shows change in large text. Quick-amount buttons (exact, round-up) appear.
- **UPI/Card:** one tap selects. Reference fields are shown only when the tenant requires them. The cashier must tick "Payment received" (never pre-ticked) before Complete is enabled.
- **Split payment** is an expander: add rows (method + amount). "Remaining" is always visible. Complete is disabled until the remaining amount is exactly zero. The permission for splits follows the tenant setting (`payment.split`).
- **Add details (optional, collapsed):** customer name/phone/GSTIN, discount, notes. If a threshold makes a customer mandatory, the section opens by itself with a plain-language message ("Bills above ₹X need the customer's phone").

### 3.4 Completing the bill
1. Press **COMPLETE BILL** (F9 / Ctrl+Enter). The button becomes "Saving…" and is disabled. A fresh idempotency key is generated **per cart**, kept until the server answers, and reused on any retry.
2. Only the **server's response** produces the success state: invoice number, total, change due. Nothing says "Paid" or "Saved" before that.
3. After success: a small confirmation panel (invoice number, change to return) with **Print receipt** and **New bill (Enter)**. Printing starts automatically if the counter is configured for it. The cart is cleared, focus returns to the scan input, and the cashier stays in Billing.
4. If the network fails after submit: "Checking whether the bill was saved…" then retry with the same key. The outcome is shown only after the server confirms (saved, or not saved, with a way to try again).
5. If printing fails, the message is "Bill saved. The printer didn't respond — Reprint", and the bill stays valid.

### 3.5 Day start / end (inline, not a separate area)
- No open session → the billing screen shows one card: "Start the day. Cash in drawer: [____] [Start]". Items can be scanned but not completed until started (so the cashier can prepare a cart).
- "End day" lives in the account menu and opens a short count form with expected cash, counted cash and variance. A manager sign-off appears only if the variance rule requires it.

## 4. Visual design system

### 4.1 Palette (given) and usage
| Token | Hex | Use |
|---|---|---|
| `--nv-primary` | `#00D9D9` | Primary buttons, selected nav indicator, focus ring accents |
| `--nv-primary-strong` | `#00B8B8` | Hover/pressed primary; text-on-light accents |
| `--nv-accent` | `#35F5FF` | Highlights only (focus glow, scan success flash) — never body text |
| `--nv-bg` | `#F8FAFC` | App background |
| `--nv-surface` | `#FFFFFF` | Panels, inputs |
| `--nv-border` | `#E5E7EB` | Hairline borders, dividers |
| `--nv-text` | `#111827` | Primary text |
| `--nv-muted` | `#6B7280` | Secondary text, labels |

**Contrast rule (verified in tests):** `#00D9D9` and `#00B8B8` are too light for white text (below 4.5:1), so primary buttons use `#111827` text on `#00D9D9`. Cyan is never used as text colour on white. Status colours are the only additions (error red, success green, warning amber), and each always has an icon + text, never colour alone.

### 4.2 Principles
Light theme only for launch; 16 px base type (system font stack, no web-font download); numbers use tabular figures; 8-px spacing grid; 8-px radius; 1-px borders, no shadows except overlays; one primary button per screen; no decorative cards, no gradients, no entrance animations (only a 120 ms focus/hover transition, disabled under `prefers-reduced-motion`); touch targets ≥ 44 px on the POS.

### 4.3 Components (shadcn-style, built once, reused)
Button (primary/secondary/ghost/danger), Input, Select, Field (label + hint + inline error), Tabs, Dialog (only for meaningful confirmation), Sheet (mobile payment/detail), Toast, Banner (inline status), Badge, Table, EmptyState, ErrorState, Skeleton, KeyboardHelp (small “?” panel).

## 5. Product entry (dynamic form)

Step 1 is a choice of three big buttons: **Clothing · Imitation jewellery · Precious-metal jewellery**. Step 2 shows only that type's fields:

| Type | Visible fields | Hidden behind "More options" | Defaults applied automatically |
|---|---|---|---|
| Clothing | Style name, brand, category, price, sizes (multi-select chips), colours (multi-select chips) → **variant grid** auto-generated (editable price/stock per cell) | HSN, tax class override, MRP, reorder level, supplier barcode, description | SKU auto, barcode auto, tax class from category, cost optional |
| Imitation jewellery | Design/name, category, price, quantity of tags to create | HSN, tax class, cost, image | One tag per quantity, tag + barcode auto, status `IN_STOCK` once received |
| Precious-metal | Design/name, category, metal, purity, gross weight, net weight, **pricing mode** (Fixed tag / By metal rate); then: Fixed → tag price; By rate → rule (default pre-selected), making charge shown from the rule, stone lines (add-row), live price preview | HSN/huid, tax class override, cost | Tax class from category, rule from category/metal/purity default |

Rules: inline validation as the user types (weights, net ≤ gross, price ≥ 0); no Save until valid; labels written in plain language; "Save and print labels" is the main button after creation; batch label printing from the Products list by checkbox selection. **Every column in the data model still exists.** Hidden fields get defaults, so none are dropped.

## 6. Speed and mistake prevention

- **Every data view has five states:** loading (skeleton), empty (what to do next), error (plain reason + what to do + retry), success (toast or inline), permission-denied ("Your role can't do this. Ask the owner.").
- **Confirmations only for:** void bill, cancel receipt, deactivate user/branch, discard a non-empty cart, close day with a variance. Never for add, edit, print, or normal checkout.
- **Errors in plain language** from a single map (§7.2). Every error says what happened and what to do.
- **Keyboard shortcuts** (documented in a "?" panel): `/` or F2 focus scan box; F9 or Ctrl+Enter complete; Esc close dialog; Del remove selected line; ↑↓ move through lines; F6 discount. Shortcuts are optional, since all actions are also visible buttons.
- **Responsive:** desktop (≥ 1024), tablet (768–1023), phone (< 768). The POS is a two-column layout on desktop/tablet and stacked with a sticky pay bar on phone.

## 7. Backend safeguards that do not change

### 7.1 Stay as specified
Tenant/branch isolation, RLS, server-side pricing and tax, atomic checkout, idempotency, row locks, ledger integrity, audit log, invoice snapshots, manager approvals, immutable invoices. The UI only calls the contracts in [API_SPECIFICATION.md](API_SPECIFICATION.md). It never calculates final money.

### 7.2 Plain-language error map (excerpt)
| Code | Message shown | What the user can do |
|---|---|---|
| `BARCODE_NOT_FOUND` | "No item has this barcode." | Check the tag, or search by name. |
| `ITEM_ALREADY_SOLD` | "This piece was already sold." | Set it aside and tell the manager. |
| `ITEM_NOT_IN_BRANCH` | "This item belongs to a different branch." | |
| `ITEM_ON_HOLD` | "This item is on hold and can't be sold." | Ask a manager. |
| `INSUFFICIENT_STOCK` | "Only N left in stock." | Reduce quantity. |
| `PRICE_STALE` | "The price changed. Please review the new total." | Cart refreshes; recheck, then complete. |
| `RATE_NOT_AVAILABLE` | "Today's gold rate isn't set." | Ask the owner to enter it. |
| `SESSION_NOT_OPEN` | "Start the day before billing." | Enter opening cash. |
| `IDEMPOTENCY_REPLAY` | (silent) shows the original bill | |
| `NETWORK` | "No connection. Your cart is safe." | Try again when online. |

## 8. Highest-impact changes (in order of delivery)
1. Design tokens and component kit (this plan §4).
2. Billing workspace with exact-match scanning (§3), including the safe checkout and error states.
3. Five-item navigation shell with role-based visibility (§2).
4. Dynamic product-entry form with variant grid (§5).
5. Sales workspace (bill lookup → reprint/return/void).
6. Everything else is placed inside the existing five workspaces.

## 9. Delta table (what changes against the PRD/TRD drafts)

| Ref | PRD/TRD text | Change | Safeguard retained |
|---|---|---|---|
| FR-POS-01 | Open cash session required | Inline "Start the day" card on Billing; completion still requires an open session | Yes |
| FR-POS-05 | Customer details optional/mandatory by threshold | Collapsed by default; auto-opens when required | Yes |
| FR-BAR-03/06 + FR-CAT-03 | Barcode & search | Single input; exact match wins; no partial barcode match | Stronger |
| TRD §3.3 / §4 | Route tree and keyboard map | Five workspaces; F-key map replaced by §6 shortcuts | N/A |
| PRD §4.4 | Catalogue screens | "Products & Stock" workspace with a type-first form | Yes |
| FR-RPT-01 | Dashboard | Replaced by a plain list of reports, with numbers only, no charts | Yes |
| FR-USR-05 | Idle lock | Unchanged | Yes |

## 10. Implementation status of this plan

Tracked in [IMPLEMENTATION_TRACKER.md](IMPLEMENTATION_TRACKER.md), which records only what has been built and tested.
