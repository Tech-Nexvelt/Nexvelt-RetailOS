# NexVelt RetailOS — Technical Requirements Document (TRD)

| Field | Value |
|---|---|
| Document ID | NXR-TRD |
| Version | 0.1 (Phase 0 baseline — draft for review) |
| Date | 2026-10-10 |
| Status | Draft |
| Inputs | [PRD](PRD.md), [Assumptions & Open Questions](ASSUMPTIONS_AND_OPEN_QUESTIONS.md) |

---

## 1. Purpose

This document defines how RetailOS satisfies the [PRD](PRD.md): architecture, component boundaries, data and security design, transactional behaviour, hardware integration, environments and operations. Detailed schema, contracts and policies are in [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [API_SPECIFICATION.md](API_SPECIFICATION.md) and [SECURITY_MODEL.md](SECURITY_MODEL.md).

---

## 2. Technology stack and versions

Versions were checked against the npm registry on **2026-10-10**. The policy is to select the **latest patch of the newest minor line that has been generally available for at least four weeks**, and not adopt a release in its first days. Exact versions are pinned in `package.json` and the lockfile during task T1.01 and re-verified then.

| Concern | Choice | Version line selected | Latest observed (2026-10-10) | Rationale |
|---|---|---|---|---|
| Runtime | Node.js LTS | 24.x LTS for CI and production. 22.x (≥ 22.13) acceptable locally | Local machine: 22.23.2 | Next.js 16 requires Node ≥ 20.9. Using 24.x avoids a mid-contract runtime upgrade, since 22.x reaches end of life in April 2027. |
| Package manager | **npm** (bundled with Node; decision D-13, supersedes the earlier pnpm proposal) | npm 10.9.x, recorded in `packageManager`; `package-lock.json` is the only lockfile | npm 10.9.8 installed locally | One tool with no extra global install on Windows or CI. Deterministic with `npm ci`. Exact versions are enforced by `.npmrc` (`save-exact=true`) and `engine-strict=true`. Mixing managers is prevented by CI failing if `pnpm-lock.yaml` or `yarn.lock` exists. |
| Framework | Next.js (App Router) | **16.3.x** (16.3.8 at time of writing) | 16.4.0 (released 2026-10-06) | 16.4.0 is too new for a financial system; upgrade to 16.4.x after it has had ≥ 4 weeks of patches. |
| UI library | React / React DOM | 19.x as required by the Next.js peer range (19.3.x) | 19.3.0 | Next.js 16 peer dependency is `^19.0.0`. |
| Language | TypeScript | **6.0.x** (JS-based compiler) | 7.0.2 (native compiler) | TypeScript 7 is a new native compiler. Adopt it only after Next.js's TS plugin and typescript-eslint officially support it (re-evaluated quarterly, D-01). |
| Styling | Tailwind CSS | 4.3.x | 4.3.3 | |
| Components | shadcn/ui (CLI `shadcn` 4.x), Radix primitives, Lucide icons (`lucide-react` 1.x) | latest at T1.06 | shadcn 4.21.4, lucide-react 1.54.0 | Components are copied into the repository (`src/components/ui`), so there is no runtime version lock-in. |
| Validation | Zod | 4.x | 4.6.5 | Shared input schemas for server actions and forms. |
| Forms | react-hook-form + `@hookform/resolvers` | 7.x | 7.89.0 | |
| Auth | Supabase Auth via `@supabase/ssr` + `@supabase/supabase-js` | ssr 0.12.x, supabase-js 2.11x | 0.12.7 / 2.117.3 | `@supabase/ssr` peer dependency: supabase-js ≥ 2.114. Cookie-based SSR sessions. |
| Database | Supabase PostgreSQL | Postgres 17 (Supabase-managed default at project creation) | — | Row Level Security, PL/pgSQL, exact `numeric` arithmetic. |
| Database tooling | Supabase CLI (`supabase`) | 2.x | 2.120.0 | Local stack, migrations, type generation, pgTAP test runner. |
| Storage | Supabase Storage | — | — | Tenant logos, optional product images, import files. |
| Barcode rendering | bwip-js | 4.x | 4.11.4 | Code 128, EAN-13, UPC-A and QR rendered as SVG. Pure JavaScript, runs on server and client. |
| Camera decoding | Native `BarcodeDetector`, fallback `zxing-wasm` | zxing-wasm 3.x | 3.1.5 | iOS Safari lacks BarcodeDetector, so a WebAssembly fallback is required. |
| Money (client display and formatting only) | Native `Intl.NumberFormat('en-IN')`, `decimal.js` for client-side arithmetic previews | decimal.js 10.x | 10.6.0 | Authoritative arithmetic happens in PostgreSQL `numeric` (§11). |
| Tables | TanStack Table | 8.x | — | Data grids for catalogue and reports. |
| Unit / integration tests | Vitest | latest stable 4.x/5.x verified at T1.03 | 5.0.3 | |
| End-to-end tests | Playwright | 1.6x | 1.64.0 | Satisfies the Next.js peer range ≥ 1.51.1. |
| Database tests | pgTAP via `supabase test db` | — | — | Tests for RLS, constraints and functions. |
| Lint / format | ESLint (flat config, `eslint-config-next` 16.x), Prettier 3.x | ESLint 9.x/10.x as supported by eslint-config-next | ESLint 10.12.0, Prettier 3.9.9 | |
| Logging | pino | 10.x | 10.4.0 | Structured JSON logs. |
| Error monitoring | Sentry (`@sentry/nextjs`) — proposed (D-09) | 11.x | 11.6.0 | Peer range includes Next.js `^16.0.0-0`. |
| Hosting | Vercel (Node.js runtime, region `bom1` Mumbai) + Supabase (region `ap-south-1` Mumbai) | — | — | D-02. |
| CI | GitHub Actions | — | — | Assumes a GitHub organisation owned by Nexvelt or the client (OQ-28). |

**Version compatibility checks performed:** Next 16 peer dependencies (`react ^19`, `@playwright/test ^1.51.1`); `@sentry/nextjs` peer `next ^16.0.0-0`; `@supabase/ssr` peer `@supabase/supabase-js ^2.114.0`; `eslint-config-next` peers `eslint >=9`, `typescript >=3.3.1`. T1.01 repeats these checks with the final pins and records them in `docs/DECISIONS.md` (created in Phase 1).

---

## 3. System architecture

### 3.1 Context

```
                ┌──────────────────────── Store (NR Collections) ───────────────────────┐
                │  Counter PC (Chrome/Edge)          Phone (Chrome Android / Safari iOS)│
                │  ├─ HID barcode scanner (USB/BT)   └─ camera scanning                 │
                │  ├─ 80 mm thermal receipt printer (OS driver)                         │
                │  ├─ Label printer (OS driver)                                          │
                │  └─ Cash drawer (via receipt printer, if supported)                    │
                └───────────────┬───────────────────────────────────────────────────────┘
                                │ HTTPS (TLS 1.2+)
                ┌───────────────▼──────────────────────────────┐
                │ Vercel — Next.js 16 App Router (Node runtime, │
                │ region bom1)                                  │
                │  • React Server Components (read paths)      │
                │  • Server Actions (mutations)                 │
                │  • Route Handlers (exports, print docs,       │
                │    health, auth callback)                    │
                │  • proxy.ts (session refresh only)           │
                └───────┬───────────────────────┬──────────────┘
         user JWT +      │                       │ secret key (server-only,
         publishable key │                       │ admin module only)
                ┌───────▼───────────────────────▼──────────────┐
                │ Supabase (ap-south-1)                         │
                │  • Auth (email+password, TOTP MFA)            │
                │  • PostgreSQL 17: tables + RLS + PL/pgSQL RPC │
                │  • Storage (private buckets, RLS)             │
                └───────────────────────────────────────────────┘
       Side systems: Sentry (errors), uptime monitor, SMTP provider (auth emails),
       GitHub Actions (CI, scheduled logical backups to off-platform storage)
```

### 3.2 Component boundaries

| Component | Responsibility | Must not |
|---|---|---|
| **Browser client** | Rendering, cart state, scanner/camera input, local draft persistence, print rendering. | Hold any secret. Call Supabase data APIs directly. Calculate authoritative amounts. |
| **Next.js server — read path** (RSC) | Fetch data with the **user-scoped** Supabase client (RLS applies). Render pages. | Cache tenant data across users. Use the secret key. |
| **Next.js server — mutation path** (Server Actions) | Parse input with Zod, resolve session context, check permissions (first gate), call PostgreSQL RPCs with the user's JWT, map errors, write application logs. | Implement financial invariants on its own. These live in the database. |
| **Route Handlers** | CSV export streaming, printable document HTML, auth callback, `/api/health`. | Bypass the same guards used by actions. |
| **Admin module** (`src/server/db/admin.ts`) | Supabase Admin API (invite users, create auth users for tenant provisioning). Only callable from platform-admin and owner-invite flows. | Be imported anywhere else. Enforced by an ESLint `no-restricted-imports` rule and the `server-only` package. |
| **PostgreSQL** | Source of truth. RLS for all reads. SECURITY DEFINER RPCs for every ledger or financial write, with explicit authorization inside. Authoritative pricing, tax, sequence and stock logic. Audit triggers. | Expose private helper schemas through the Data API. |
| **Supabase Auth** | Identity, sessions, MFA, password reset. | Hold authorization data in user metadata. Authorization lives in membership tables. |

### 3.3 Code layout (planned)

```
/
├─ docs/                         # this documentation set + DECISIONS.md, IMPLEMENTATION_TRACKER.md (Phase 1)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                # timestamped SQL migrations (M0001…)
│  ├─ tests/                     # pgTAP: rls/, functions/, constraints/
│  └─ seed.sql                   # local/dev only (never production)
├─ src/
│  ├─ app/
│  │  ├─ (public)/login, reset-password, auth/callback
│  │  ├─ admin/                  # platform admin console
│  │  └─ t/[tenant]/             # tenant-scoped
│  │     ├─ settings/, users/, catalogue/, suppliers/, pricing/, reports/, audit/
│  │     └─ b/[branch]/          # branch-scoped
│  │        ├─ pos/, cash/, receiving/, stock/, returns/, labels/, invoices/
│  ├─ components/ui/             # shadcn/ui generated components
│  ├─ components/<feature>/      # feature components (pos, scanner, print, …)
│  ├─ server/
│  │  ├─ db/                     # client factories: user.ts (RLS), admin.ts (restricted)
│  │  ├─ auth/                   # session context, guards (requirePermission, requireBranch)
│  │  ├─ actions/<area>.ts       # server actions (thin)
│  │  └─ services/<area>.ts      # orchestration helpers
│  ├─ domain/                    # pure TS: money formatting, schemas, error codes, barcode utils
│  ├─ lib/scanner, lib/print, lib/barcode
│  ├─ types/database.ts          # generated by `supabase gen types`
│  └─ env.ts                     # Zod-validated environment
├─ tests/ (unit/, integration/, e2e/, perf/)
└─ .github/workflows/
```

### 3.4 Routing and tenancy in URLs (D-06)

Tenant and branch are explicit in the path: `/t/{tenantCode}/b/{branchCode}/pos`. Every layout and action resolves the codes to IDs **server-side** and verifies membership. A URL is never treated as authorization. Two browser tabs can work on different branches without cookie races.

---

## 4. Frontend design

- **Rendering:** Server Components by default. Client Components only for interactive surfaces (POS cart, scanner, dialogs, forms, charts).
- **Data freshness:** All tenant pages are dynamic. No shared caching of authenticated data. Mutations call `revalidatePath`/`refresh` for affected routes.
- **POS state:** The cart is a client-side reducer, persisted to `localStorage` under a key namespaced by tenant, branch, counter and user (FR-POS-10). The draft holds only IDs, quantities and discounts, never amounts that the server would trust. The draft is cleared after a successful checkout or an explicit cancel.
- **Pricing display:** Each cart change calls `quoteCart` (API-PRC-04) with a 150 ms debounce. Totals shown are **server quotes**. A local estimate may be shown greyed until the quote returns.
- **Design system:** Tailwind 4 tokens, shadcn/ui components and Lucide icons. Large touch targets on the POS (≥ 44 px). High-contrast theme. Keyboard shortcuts: F2 search, F4 quantity, F6 discount, F8 pay, F9 complete, Esc cancel dialog.
- **Formatting:** `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`. Weights shown with 3 decimals and the unit. Dates `DD-MM-YYYY` in the branch time zone.
- **Connectivity:** A `navigator.onLine` check plus a heartbeat to `/api/health` every 15 s on the POS. When offline, the Complete button is disabled and a banner is shown (FR-POS-12).
- **Accessibility:** Radix primitives, `aria-live="assertive"` region for scan results, focus management after each scan.

---

## 5. Backend design

### 5.1 Server Actions as public endpoints

Every server action is treated as a public HTTP endpoint and follows the same template:

```ts
export const checkoutAction = action({
  input: CheckoutInput,                         // Zod schema
  permission: 'sale.create', scope: 'branch',      // first-gate authorization
  rateLimit: { key: 'checkout', perMinute: 30 },
  handler: async ({ input, ctx }) => {
    const { data, error } = await ctx.db.rpc('pos_checkout', toRpc(input)); // user JWT → RLS + in-function checks
    if (error) throw mapDbError(error);          // stable error codes (API spec §2.3)
    return data;
  },
});
```

`ctx` is built from `supabase.auth.getClaims()`/`getUser()` (verified JWT, never the unverified session object) plus memberships loaded under RLS. The wrapper returns the standard result envelope (API spec §2.2). Thrown errors are logged with the request ID and returned as sanitized codes.

### 5.2 Where logic lives

| Logic | Location | Reason |
|---|---|---|
| Input shape and format validation | Zod (server action) | Fast failure, typed. |
| Authorization (first gate) | Server action guard | User-friendly errors. Prevents unnecessary database calls. |
| Authorization (final gate) | RLS policies and in-function checks (`private.assert_branch_permission`) | Cannot be bypassed even if PostgREST is called directly with a user JWT. |
| Pricing, tax, totals, rounding | PostgreSQL functions (`pricing`, `tax` schemas) — **D-03** | One authoritative implementation, exact `numeric`, same transaction as checkout, cannot be bypassed. |
| Stock, sequences, idempotency | PostgreSQL RPCs | Requires transactional locking. |
| Presentation (formatting, layouts) | TypeScript | |

---

## 6. Database design summary

The full design is in [DATABASE_DESIGN.md](DATABASE_DESIGN.md). Key rules:

1. Every tenant-owned table has `tenant_id uuid NOT NULL`. Branch-scoped tables also have `branch_id`.
2. Child tables reference parents with **composite foreign keys `(tenant_id, parent_id)`**, so a row can never point at another tenant's record.
3. Money is `numeric(14,2)`, rates are `numeric(14,4)`, weights are `numeric(12,3)`, percentages are `numeric(7,4)`. Floating-point types are never used.
4. Timestamps are `timestamptz` (UTC). Business date is `date`, derived in the branch time zone.
5. Enumerations are `text` with `CHECK` constraints, which are easier to evolve than Postgres enums.
6. Ledger and financial tables are append-only from the application's perspective. Corrections are new rows.
7. Schemas: `public` (exposed tables and RPCs), `private` (helper functions, not exposed through the Data API), `pricing` and `tax` (calculation functions, not exposed; reached through `public` RPC wrappers).

---

## 7. Tenant and branch isolation

| Layer | Mechanism |
|---|---|
| URL | Tenant and branch codes resolved server-side. No implicit trust. |
| Server | `requireTenant(code)` and `requireBranch(tenantId, code, permission)` guards on every page and action. |
| Database reads | RLS `SELECT` policies using `private.has_tenant_access(tenant_id)` and `private.has_branch_access(branch_id)`. |
| Database writes | Master data: RLS `INSERT/UPDATE` with permission checks and guard triggers on sensitive columns. Ledger/financial data: no `INSERT/UPDATE/DELETE` grants to `authenticated`; writes only via SECURITY DEFINER RPCs that call `private.assert_*`. |
| Referential | Composite `(tenant_id, id)` foreign keys. |
| Storage | Bucket object path prefix `{tenant_id}/…` with storage RLS policies using the same helpers. |
| Platform admins | No RLS bypass. Access only through `support_access_grants` (time-bound, owner-granted, audited). |
| Tests | pgTAP negative suite (TC-SEC-*) runs in CI on every pull request. |

Helper functions are `STABLE SECURITY DEFINER`, use `SET search_path = ''`, read `(select auth.uid())` once per statement, and are backed by indexes on `(user_id, status)` of membership tables. Suspended tenants and inactive memberships return false.

---

## 8. Authentication and authorization

- **Identity:** Supabase Auth with email and password. Email invites for onboarding. Password reset by email. Custom SMTP is required for production (D-10), because the built-in mailer is rate-limited and not intended for production use.
- **MFA:** TOTP. Tenant Owners and Platform Admins must reach `aal2`. Guards check the `aal` claim, and sensitive RPCs check `auth.jwt()->>'aal' = 'aal2'` for owner-only actions (rule activation, tax settings, support grants).
- **Sessions:** Cookie-based through `@supabase/ssr`. `proxy.ts` (Next.js 16's replacement for `middleware.ts`) refreshes sessions only and does no authorization. JWT expiry is 1 hour (Supabase default) with refresh rotation. The POS idle lock (FR-USR-05) is client-side and re-authenticates with password.
- **Manager approval on the counter** (discount override, return outside policy, void): the manager enters their credentials in an approval dialog. The server verifies them through a separate, non-persisted auth call. On success, it issues a single-use **approval token** row (`approval_grants`: approver, action type, scope hash, expiry of 2 minutes). The RPC consumes the token and verifies the approver holds the permission. The cashier's session is unchanged.
- **Authorization data:** `tenant_memberships`, `branch_memberships`, `roles`, `role_permissions`. These are read at request time and are **not** embedded in JWT claims, so revocation is immediate (FR-USR-02).

---

## 9. API / server-action contracts

Defined in [API_SPECIFICATION.md](API_SPECIFICATION.md). Conventions: Zod-validated input; result envelope `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors?, retryable } }`; stable error codes; idempotency keys on every financial mutation.

---

## 10. Migrations and seed strategy

- **Tooling:** Supabase CLI migrations in `supabase/migrations/<timestamp>_<name>.sql`. Logical IDs M0001–M0012 are mapped to files in [DATABASE_DESIGN.md](DATABASE_DESIGN.md) §13.
- **Rules:**
  1. Migrations are forward-only. A mistake is corrected with a new migration, never by editing an applied one.
  2. Every migration that creates a table also enables RLS on it in the same migration. A CI check queries `pg_tables` for tables in `public` with `rowsecurity = false` and fails the build.
  3. Destructive changes (drop, type narrowing, data rewrite) need an expand → migrate → contract sequence across releases, plus **explicit written approval** before applying to production.
  4. `supabase db diff` must be empty after applying migrations to a fresh database (drift check in CI).
  5. Generated types (`supabase gen types typescript`) are committed and checked in CI.
- **Seeds:**
  - `supabase/seed.sql` — **local/dev only**: permissions catalogue, system roles, demo tenant "Demo Retail" and a dev copy of the NR Collections structure with fictitious products.
  - Reference data needed in every environment (permission keys, system roles and their permissions) is inserted by **migrations**, not seeds, so production gets it deterministically.
  - Production tenant creation uses the platform admin console (API-TEN-01), never SQL scripts against production.

---

## 11. Pricing and tax calculation engine (D-03)

### 11.1 Principles

1. There is one authoritative implementation in PostgreSQL. `quoteCart` (preview) and `pos_checkout` (commit) call the **same** functions.
2. The rule engine is data-driven with a **closed set of component types**. There is no expression evaluation, no `eval`, and no user-entered formulas, which avoids injection and makes every rule auditable.
3. All arithmetic uses `numeric`. Rounding uses an explicit `ROUND(x, 2)` half-away-from-zero at defined points, unless the client policy (OQ-08) specifies otherwise. The rounding mode is a rule setting.
4. No default rule ships in production. The tenant must configure and activate one before `METAL_RATE` items can be sold (FR-PRC-07).

### 11.2 Inputs

| Input | Source |
|---|---|
| Item attributes | `jewellery_items` (metal type, purity, gross/net weight, pricing mode, tag price, pricing rule), `jewellery_item_stones` |
| Rate | `metal_rates`: latest row with `effective_from ≤ now()` for (tenant, metal type, purity), honouring the staleness policy (FR-PRC-06) |
| Rule | `pricing_rules` (active version assigned to the item, or the default for its category/metal/purity) + `pricing_rule_components` ordered by `seq` |
| Tax | `tax_classes`, `tax_rates` (effective-dated, optional unit-value slabs), tenant inclusivity setting, place of supply vs branch state |

### 11.3 Component catalogue

| `component_type` | Supported `basis` | Notes |
|---|---|---|
| `METAL_VALUE` | `PER_GRAM_NET`, `PER_GRAM_GROSS` | amount = weight × rate (the rate is the value; `value` is ignored). Exactly one per rule. |
| `WASTAGE` | `PERCENT_OF_WEIGHT_NET`, `PERCENT_OF_WEIGHT_GROSS`, `PER_GRAM_NET` (fixed grams), `PERCENT_OF_METAL_VALUE` | Weight-based variants convert the added weight at the same rate. |
| `MAKING_CHARGE` | `PER_GRAM_NET`, `PER_GRAM_GROSS`, `PERCENT_OF_METAL_VALUE`, `FLAT_PER_ITEM` | Optional `min_amount`/`max_amount`. |
| `STONE_CHARGE` | `ITEM_STONE_CHARGES` (sum of the item's stone lines), `FLAT_PER_ITEM` | |
| `HALLMARK_CHARGE` | `FLAT_PER_ITEM` | |
| `OTHER_CHARGE` | `FLAT_PER_ITEM`, `PERCENT_OF_METAL_VALUE` | Requires a label. |

Each component has: `seq`, `label` (printed), `value`, `min_amount`, `max_amount`, `is_taxable`, `tax_class_id` (null = item's class), and `discountable` (whether line discounts may reduce it — needed if OQ-21 restricts discounts to making charges).

**Adding a component type is a code change** (migration + tests), not configuration. This is deliberate.

### 11.4 Algorithm — `pricing.price_jewellery_item(item_id, at timestamptz, rule_override uuid)`

```
1. Load the item and FOR SHARE (FOR UPDATE inside checkout).
2. IF pricing_mode = FIXED_TAG → return one component {type: TAG_PRICE, amount: tag_price}.
3. Resolve rule (item.pricing_rule_id or category/metal/purity default; must be ACTIVE at `at`).
4. Resolve rate R (must satisfy staleness policy) → error RATE_NOT_AVAILABLE otherwise.
5. ctx := {w_net, w_gross, R, stone_sum, metal_value := null}
6. FOR component IN rule.components ORDER BY seq:
       amount := evaluate(component.type, component.basis, component.value, ctx)
       amount := clamp(amount, min_amount, max_amount)
       amount := round(amount, 2)
       IF type = METAL_VALUE THEN ctx.metal_value := amount
       emit {seq, type, label, basis, qty_basis, rate_or_value, amount, is_taxable, tax_class_id, discountable}
7. pre_tax := Σ amounts; apply rule-level rounding (increment, mode) → rounding adjustment component
8. return components + rule_id + rule_version + rate_id + rate_value
```

Validation at rule activation: exactly one `METAL_VALUE` component; `PERCENT_OF_METAL_VALUE` components must have `seq` after `METAL_VALUE`; values ≥ 0; min ≤ max.

### 11.5 Tax — `tax.compute_line(taxable_amount, tax_class_id, inclusive bool, unit_qty, intra_state bool, at date)`

1. Load `tax_rates` for the class effective at `at`. There may be several slabs with `min_unit_value`/`max_unit_value`.
2. **Exclusive pricing:** choose the slab where the per-unit taxable value falls within its bounds. Tax = taxable × rate.
3. **Inclusive pricing:** for each slab in ascending rate order, compute `taxable = gross / (1 + rate)` and accept the first slab whose bounds contain the per-unit taxable value. If none is consistent, raise `TAX_SLAB_AMBIGUOUS`. This prevents silent mis-taxation and covers value-based slabs such as those used for apparel. **The actual rates and slab values are configuration confirmed by the client's tax advisor (OQ-10); none ship as defaults.**
4. Split: intra-state → CGST = SGST = round(tax/2, 2), with any odd paisa assigned to SGST. Inter-state → IGST. Cess is supported but defaults to 0.
5. Invoice round-off: per the tenant rule (OQ-08), stored as a separate `round_off` amount.

### 11.6 Discounts

Line discounts reduce the taxable value of discountable components proportionally. Invoice-level discounts are allocated to lines pro-rata by pre-discount taxable value, with the remainder (paise) assigned to the largest line. Allocation is deterministic and tested. Limits come from `role_discount_limits`. An approval token allows exceeding them.

### 11.7 Quotes and staleness (FR-PRC-05)

`quoteCart` returns each line's `price_basis` = `{rate_id, rule_id, rule_version}` (or `{tag_price}` / `{variant_price, price_updated_at}`). Checkout passes these back. `pos_checkout` recomputes the price **inside the transaction** and compares:
- If the basis IDs differ (rate superseded, rule changed, price edited) → `PRICE_STALE` with fresh quotes in the error payload.
- If the basis matches but the client's `expected_grand_total` differs from the recomputed total → `TOTAL_MISMATCH` (indicates a client bug). The transaction is rejected.

---

## 12. Inventory, checkout, idempotency and concurrency

### 12.1 Ledger model

- `inventory_movements` (append-only) is the source of truth. `inventory_balances` (variant × branch) is a maintained projection, updated **in the same transaction** by `private.apply_variant_movement()`.
- Jewellery items: the item row's `status` + `branch_id` is the balance. Every status change writes an `inventory_movements` row with `quantity_delta` ±1 for the item.
- Invariant (tested and checked by a nightly job): `inventory_balances.on_hand = Σ movements.quantity_delta` per (branch, variant). `CHECK (on_hand >= 0)` unless the tenant has allowed negative stock (OQ-25), in which case the check is enforced by the function instead.

### 12.2 Checkout transaction — `public.pos_checkout(p jsonb)` (SECURITY DEFINER)

```
SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '20s';
1  actor := auth.uid(); assert actor active; assert_branch_permission(branch, 'sale.create')
2  assert counter belongs to branch; cash_session OPEN for counter (FOR SHARE)
3  idempotency:
      INSERT INTO idempotency_keys(tenant_id, scope='checkout', key, request_hash, actor, status='PENDING')
      ON CONFLICT (tenant_id, scope, key) DO NOTHING
      if not inserted: SELECT … ; if request_hash differs → IDEMPOTENCY_KEY_REUSED
                       if COMPLETED → RETURN stored response (no side effects)
      (a concurrent duplicate blocks on the unique index until the first commits or rolls back)
4  lock jewellery items: SELECT … FROM jewellery_items WHERE id = ANY(ids) ORDER BY id FOR UPDATE
      each must be status IN_STOCK, branch = p.branch, active → else ITEM_NOT_AVAILABLE(item)
5  lock balances: SELECT … FROM inventory_balances WHERE (branch, variant) IN … ORDER BY variant_id FOR UPDATE
      on_hand >= qty (unless negative allowed + approval) → else INSUFFICIENT_STOCK(variant, available)
6  price every line (pricing.*, tax.*) → compare basis + expected totals (§11.7)
7  validate discounts vs limits / approval token
8  validate payments: Σ applied = grand_total; cash tendered ≥ cash applied; references per config;
      cash threshold policy (FR-PAY-06)
9  allocate number: UPDATE document_sequences SET next_number = next_number + 1
      WHERE (tenant, branch, 'INVOICE', fy) RETURNING … (row lock → gapless)
10 INSERT invoices, invoice_items, invoice_item_price_components, invoice_item_costs, payments
11 UPDATE jewellery_items SET status='SOLD', sold_invoice_item_id=…; INSERT movements
   apply_variant_movement(… -qty …) for each variant line
12 INSERT audit_logs; UPDATE idempotency_keys SET status='COMPLETED', response=…, invoice_id=…
13 RETURN {invoice_id, invoice_number, totals, print_url}
```

Any exception rolls back everything, including the idempotency row, so the client can retry safely with the same key.

### 12.3 Concurrency controls

| Hazard | Control |
|---|---|
| Two counters sell the same jewellery item | `FOR UPDATE` row lock + status check. The second transaction waits, then sees `SOLD` and fails with `ITEM_NOT_AVAILABLE`. A partial unique index on `invoice_items(jewellery_item_id) WHERE line_status='SOLD'` acts as a second guard. |
| Last unit of a variant sold twice | `FOR UPDATE` on the balance row + `CHECK (on_hand >= 0)`. |
| Double-click / retry | Idempotency key unique per tenant and scope. Request hash comparison. |
| Deadlocks | Deterministic lock order: sequence row last, items by `id`, balances by `variant_id`. `lock_timeout` 5 s → `CONCURRENT_UPDATE` (retryable). |
| Gapless numbers | The sequence row is updated inside the transaction, and a rollback releases the number. Throughput is serialized per branch per document type, which is acceptable for counter-scale volumes (NFR-11). |
| Rate changed mid-cart | `PRICE_STALE` (§11.7). |
| Rule version activated mid-checkout | Activating a rule takes `FOR UPDATE` on the rule family. Checkout reads rules `FOR SHARE`. |
| Master-data edit during checkout | Variant price row read `FOR SHARE` in checkout. A price update waits for it. |

### 12.4 Other transactional RPCs

`pos_void_invoice`, `pos_return`, `pos_exchange` (return + sale in one transaction, reusing the internal functions of `pos_checkout`), `purchase_receipt_post`, `purchase_receipt_cancel`, `stock_adjustment_post`, `cash_session_open/close`, `cash_movement_record`, `payment_method_correct`, `metal_rate_create`, `pricing_rule_activate`. All follow the same pattern: authorize → idempotency → lock in deterministic order → validate → write → audit.

---

## 13. Barcodes and scanning

### 13.1 Symbologies and values (D-05, OQ-14)

| Use | Symbology | Value format (proposed, pending OQ-14) |
|---|---|---|
| Clothing variant (system) | Code 128 (subset B/C auto) | `{tenantPrefix}{8-digit sequence}`, e.g. `NR00001234` |
| Jewellery item tag | Code 128 | Tag ID `{kindPrefix}{7-digit sequence}`, e.g. `IJ0000123` (imitation), `GJ0000045` (precious) |
| Supplier codes (alias) | EAN-13, UPC-A, Code 128 | As printed. EAN/UPC check digit validated. |
| Invoice on receipt | QR (or Code 128) | Invoice number |

Values are uppercase alphanumeric only, which avoids scanner keyboard-layout issues with symbols. Sequences come from `document_sequences` (types `BARCODE`, `TAG_IJ`, `TAG_PJ`). Uniqueness is enforced by `UNIQUE (tenant_id, code)` on `barcode_aliases`.

### 13.2 Handheld scanners (HID)

- Scanners act as keyboards. A global `useScanner` hook listens for `keydown` events when no text field is focused, **or** in the dedicated scan input.
- A burst is classified as a scan when it has ≥ 4 characters, inter-key intervals ≤ 35 ms (configurable), and is terminated by Enter/Tab (configurable suffix). Optional prefix characters are configurable.
- Each scan is sent to `resolveBarcode` (API-BAR-01). Feedback uses distinct tones generated with the WebAudio API (no audio files) plus a visual toast.
- Setup guide: put the scanner in USB-HID/BT-HID keyboard mode, US layout, suffix CR, with symbologies Code 128, EAN-13 and QR enabled. The settings page has a test pad that shows the raw keystrokes and timings.

### 13.3 Camera scanning

- `if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('code_128'))` → native. Otherwise lazy-load `zxing-wasm` (WASM served from the app's own origin, no third-party CDN at runtime).
- `getUserMedia({ video: { facingMode: 'environment' } })`. Torch toggle where supported. Decode throttled to about 8 fps. A code is accepted after 2 identical consecutive reads, to avoid misreads. 1.5 s cooldown per code.
- Failure handling: permission denied, no camera or unsupported browser → explanatory message and manual entry. Requires HTTPS, which is always the case in staging and production. Locally, `localhost` counts as secure.

---

## 14. Printing strategy (D-04)

### 14.1 Receipts

- Printable route `/t/{t}/b/{b}/invoices/{id}/print?format=thermal80|thermal58|a4`, rendered as HTML with `@page { size: 80mm auto; margin: 0 }` and a monospace-friendly layout, then printed with `window.print()` from a hidden iframe.
- **Silent printing** (no dialog) on the counter PC: launch Chrome/Edge in kiosk-printing mode (`--kiosk-printing`) with the thermal printer as the default printer. Documented in the runbook. This is a store-device configuration, not an application feature.
- **Failure handling:** the browser does not reliably report print success, so the app records "print requested" and always offers reprint. Printer-offline errors surface through the OS. A print failure never touches the invoice (FR-INV-07).
- **Cash drawer:** opened through the receipt printer driver's "open drawer on print" setting, if the model supports it (OQ-16). Otherwise it is opened manually. No ESC/POS from the browser at launch.

### 14.2 Labels

- Templates are stored as data (`label_templates`: width/height mm, gap, columns, fields, font sizes, barcode module width/height). They are rendered to SVG/HTML at true size with `@page { size: {w}mm {h}mm }`. Barcodes are rendered by bwip-js as SVG (vector, so they stay sharp at any DPI).
- A calibration page prints a ruler and a barcode at the printer's DPI (OQ-16) to verify scannability. Acceptance requires a 100% first-read rate on 50 printed labels with the store's scanner (TC-HW-04).
- **Fallback / future:** if driver-based printing cannot hit the tolerances on the client's label printer, the fallback is a small local print agent sending raw TSPL/ZPL (FUT-06). This would be a change request.

---

## 15. Environments

| Environment | App | Database | Data | Access |
|---|---|---|---|---|
| Local | `npm run dev` | Supabase CLI local stack (Docker) | Seed (fictitious) | Developers |
| CI | Ephemeral | Supabase CLI in GitHub Actions | Seed + test fixtures | CI only |
| Staging | Vercel project `retailos-staging` (deploys from `main`) | Supabase project `retailos-staging` (ap-south-1) | Fictitious + anonymised sample of client master data (with consent) | Nexvelt team, client UAT users |
| Production | Vercel project `retailos-prod` (promoted release tags) | Supabase project `retailos-prod` (ap-south-1, paid plan, PITR if D-08 approved) | Real data | Client users. Nexvelt only through support grants and named operators. |

Pull-request preview deployments use **staging Supabase**, never production. Production secrets are not available to preview builds (Vercel environment scoping).

---

## 16. Error handling, logging and observability

- **Error taxonomy:** `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` family (e.g. `ITEM_NOT_AVAILABLE`, `INSUFFICIENT_STOCK`, `PRICE_STALE`, `IDEMPOTENCY_KEY_REUSED`), `CONCURRENT_UPDATE` (retryable), `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE` (retryable), `INTERNAL`. Database functions raise `SQLSTATE 'P0001'` with `MESSAGE = '<CODE>'` and `DETAIL` as JSON. `mapDbError` converts these to envelope codes.
- **Logs:** pino JSON with `request_id`, `tenant_id`, `branch_id`, `user_id` (UUIDs only), action name, duration and outcome. **No personal data, no payloads with customer details, no secrets.** Vercel runtime logs, with a log drain to retained storage if approved.
- **Errors:** Sentry with PII scrubbing (`sendDefaultPii: false`, `beforeSend` redaction), release tagging and source maps uploaded at build time.
- **Metrics/alerts:** checkout success/failure counts (logged events aggregated in Sentry/monitoring), p95 latency per action, Supabase database CPU/connections (Supabase dashboard alerts), uptime check on `/api/health` (checks app + DB round-trip) every 1 minute from India.
- **Health endpoint:** `/api/health` returns `{status, db: ok|fail, version}` without secrets.
- **Audit ≠ logs:** audit records live in the database (`audit_logs`) and are business records. Logs are operational and short-lived.

---

## 17. Backups and recovery

| Mechanism | Frequency | Retention | Purpose |
|---|---|---|---|
| Supabase managed daily backups (paid plan) | Daily | Per plan | Primary restore path |
| Point-in-time recovery add-on (if approved, D-08) | Continuous (WAL) | Per add-on tier | RPO minutes |
| Logical dump (`pg_dump` schema+data, custom format) via scheduled GitHub Action → encrypted object storage outside Supabase (provider per OQ-28) | Daily | 30 days rolling + monthly for 12 months | Provider-independent copy |
| Storage bucket sync | Weekly | 30 days | Logos/images |

The restore drill (runbook §8) restores the latest logical dump into a scratch project, runs integrity queries (ledger invariant, invoice sequence continuity, row counts) and records timings. It is done before go-live and quarterly afterwards.

---

## 18. Security, privacy and secrets

Detailed in [SECURITY_MODEL.md](SECURITY_MODEL.md). Technical requirements:

- **Secrets:** `SUPABASE_SECRET_KEY` (or the legacy `service_role` key), database password and Sentry auth token exist only in Vercel encrypted environment variables (Production/Preview scoped) and GitHub Actions secrets. Never `NEXT_PUBLIC_*`. `src/env.ts` fails the build if a server secret has a public prefix. Gitleaks runs in CI.
- **Browser exposure:** only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or the legacy anon key), both of which are designed to be public and are safe because RLS applies.
- **Transport:** HTTPS only, HSTS, secure/HttpOnly/SameSite=Lax cookies (Supabase SSR defaults verified at T2.05).
- **Headers:** Content-Security-Policy with nonces for scripts (`'self'`, Supabase URL, Sentry ingest), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self)`.
- **CSRF:** Server Actions are POST-only with built-in origin checks. `serverActions.allowedOrigins` is set to production domains. Route handlers that mutate are not used.
- **Supabase hardening:** Data API exposes only `public`. `private`, `pricing` and `tax` are not exposed. Default privileges revoked for `anon` on all tables. Network restrictions for direct database connections (CI and operator IPs only) where the plan supports them. Leaked-password protection enabled (if available on the plan). Email confirmation required.
- **Privacy:** customer data minimised (name, phone, optional GSTIN/address). Masked in lists for cashiers (phone shows the last 4 digits). Deleting or anonymising customer records on request keeps invoice snapshots as required by law (OQ-24, OQ-33).

---

## 19. Performance and accessibility targets

| Target | Value | Verified by |
|---|---|---|
| `resolve_barcode` server p95 | ≤ 300 ms | TC-PERF-01 |
| Scan → line rendered p95 | ≤ 700 ms | TC-PERF-02 |
| `pos_checkout` p95 (≤ 30 lines) | ≤ 2 s | TC-PERF-03 |
| Product search p95 (100k variants, trigram index) | ≤ 1 s | TC-PERF-04 |
| 12-month report p95 | ≤ 5 s | TC-PERF-05 |
| POS LCP on counter PC | ≤ 2.5 s | TC-PERF-06 |
| JS shipped to POS route (gzip) | ≤ 300 KB excluding the lazy WASM decoder | Build report |
| WCAG 2.2 AA on core flows | 0 critical/serious axe violations; manual keyboard pass | TC-A11Y-01..02 |

Database: every foreign key is indexed. Tenant-leading composite indexes cover list queries. `pg_trgm` GIN indexes on product/design names. `pg_stat_statements` is reviewed before go-live.

---

## 20. Deployment and rollback

- **Branching:** trunk-based. `main` is protected. Short-lived branches are named `feat/T3.06-variant-matrix`, `fix/…`, `chore/…`. Commits follow Conventional Commits. Pull requests require green CI and one review. Squash merge.
- **Pipeline:**
  1. PR → CI (lint, typecheck, unit, pgTAP, e2e smoke, gitleaks, audit, RLS-enabled check, drift check) → Vercel preview against staging.
  2. Merge to `main` → staging migrations applied by a CI job (`supabase db push` with the staging project ref) → staging deploy → automated smoke test.
  3. Release: tag `vX.Y.Z` → manual approval → production migration (`supabase db push --dry-run` reviewed, then applied) → Vercel production promotion → smoke test.
- **Migration/app ordering:** migrations must be backward-compatible with the currently deployed app (expand first). Code that depends on a new column ships after the column exists.
- **Rollback:**
  - App: Vercel "promote previous deployment" (instant).
  - Database: forward-fix migration. Backup or PITR restore only for data corruption, and only with explicit approval (runbook §9).
  - Feature flags (`tenant_settings.feature_flags`) let a risky feature be disabled for a tenant without a deploy.

---

## 21. Coding standards

TypeScript `strict`, `noUncheckedIndexedAccess`; no `any` without a justification comment; Zod at every trust boundary; no floating-point arithmetic on money (lint rule bans `parseFloat` and arithmetic on `amount*` fields in `src/`, enforced by review plus a custom ESLint rule); server-only modules import `server-only`; SQL style is lowercase keywords, explicit column lists, `SET search_path = ''` in functions, schema-qualified references; each PR updates `docs/IMPLEMENTATION_TRACKER.md`.

---

## 22. Technical decisions requiring client approval

| ID | Decision | Recommendation | Impact if rejected |
|---|---|---|---|
| D-01 | Stack and version policy (§2) | Approve | Re-plan Phase 1 |
| D-02 | Hosting regions: Supabase `ap-south-1` (Mumbai), Vercel `bom1` | Approve | Latency and data-residency implications |
| D-03 | Authoritative pricing and tax in PostgreSQL functions | Approve | A TypeScript engine would need the service-role path for checkout, which weakens isolation |
| D-04 | Browser/driver-based printing at launch, no local agent | Approve; reassess after hardware test T4.06 | Local agent adds about 6–8 person-days and an install on the counter PC |
| D-05 | Code 128 for system barcodes and tags | Approve unless existing tags must be kept (OQ-14) | |
| D-06 | Path-based tenant/branch routing | Approve | |
| D-07 | Postgres-based rate limiting (no Redis vendor) | Approve for launch | Add Upstash or similar later at extra cost |
| D-08 | Purchase point-in-time recovery for production | Strongly recommended for financial data | RPO falls back to 24 h |
| D-09 | Sentry for error monitoring | Approve, or nominate an alternative | Reduced diagnosability |
| D-10 | Custom SMTP provider for auth emails | Required; provider to be chosen | Invites and password resets unreliable |
| D-11 | Invoice void window = same business day + open session | Approve (OQ-34) | |
| D-12 | Hosting account ownership (client-owned vs Nexvelt-owned) | Client decision (OQ-28) | Affects handover and billing |
| D-13 | Package manager is npm, not pnpm | Approve (already in use; `package-lock.json` present) | Migrating later is possible: delete `package-lock.json`, run `pnpm import`, update CI and this document in one change |

---

## 23. Technical risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Pricing rules not confirmed in time | High | Blocks jewellery go-live | Phase 5 engine built generically. FIXED_TAG mode usable meanwhile. Go-live gate FR-PRC-07. |
| R-02 | Label printer cannot print accurately via OS driver | Medium | Labels unreadable | Early hardware test (T4.06), calibration page, fallback agent (FUT-06). |
| R-03 | iOS camera scanning unreliable for dense Code 128 on small jewellery tags | Medium | Slower mobile scanning | Handheld scanner is primary. Tune barcode module width. Manual entry fallback. |
| R-04 | Store internet outage stops billing (online-only) | Medium | Lost sales time | Backup 4G hotspot recommended. Clear offline banner. Paper fallback procedure in runbook. Offline billing in Phase 10. |
| R-05 | RLS policy mistake leaks data | Low | Critical | Negative pgTAP suite on every PR. Helper-function pattern. Policy review checklist. |
| R-06 | Invoice-number serialization contention at scale | Low (one counter) | Slower checkouts | Per-branch sequence. Revisit for many counters (per-counter series if the tax advisor allows). |
| R-07 | Next.js/Supabase breaking changes during the build | Medium | Rework | Pinned versions. Upgrade only between phases. |
| R-08 | GST configuration errors | Medium | Compliance | No default rates. CA-confirmed configuration. Tax summary report checked in UAT. |
| R-09 | Data migration quality from spreadsheets | High | Wrong opening stock | Import templates, dry-run reports, sign-off of opening stock totals. |
| R-10 | Browser print dialogs slow the cashier | Medium | UX | Kiosk-printing configuration on the counter PC. |
| R-11 | Single developer dependency | Medium | Delays | Documentation-first, tests, tracker, runbook. |

---

## 24. Amendment log

Proposed changes made while the TRD was still a draft (nothing is client-approved yet). Additive or tightening only.

| Date | Section | Change |
|---|---|---|
| 2026-10-10 | §2 | Package manager is **npm** (decision D-13), replacing the earlier pnpm proposal. |
| 2026-10-10 | §3.3, §4 | Route layout and keyboard map are superseded by [UX_SIMPLIFICATION_PLAN.md](UX_SIMPLIFICATION_PLAN.md) (five workspaces; shortcuts in §6 of that plan). Path-based tenant/branch routing (D-06) remains the intended design and arrives with Phase 2. |
| 2026-10-10 | §12.2 | Checkout additionally enforces: discount authority derived from the server-side role (default deny), reason required for any discount, discount ≤ line gross, bill total > 0, request schemas that reject unknown fields. These are implemented and unit-tested in the demo engine and must be reproduced in `pos_checkout`. |
| 2026-10-10 | §5, §18 | The billing backend **fails closed**: with no configured backend every billing action returns an error. The in-memory demo engine is enabled only by `BILLING_BACKEND=demo` and is never a fallback. |
| 2026-10-10 | §3.3 | The demo identity (a role cookie) is a development stand-in for Phase 2 authentication and is inert in production builds. |
