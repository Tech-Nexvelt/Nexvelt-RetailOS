# NexVelt RetailOS — Database Design

| Field | Value |
|---|---|
| Document ID | NXR-DB |
| Version | 0.1 (Phase 0 baseline) |
| Date | 2026-10-10 |
| Engine | PostgreSQL 17 (Supabase) |
| Related | [TRD](TRD.md) §6, §7, §11, §12 · [Security Model](SECURITY_MODEL.md) · [API Specification](API_SPECIFICATION.md) |

> **UI simplicity does not reduce the data model.** Fields hidden by the simplified UI ([UX_SIMPLIFICATION_PLAN.md](UX_SIMPLIFICATION_PLAN.md)) still exist here. They are filled by defaults or conditional forms. They are never dropped.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Primary keys | `id uuid DEFAULT gen_random_uuid()`. High-volume append-only tables (`inventory_movements`, `audit_logs`) use `bigint GENERATED ALWAYS AS IDENTITY`. |
| Tenancy | Every tenant-owned table has `tenant_id uuid NOT NULL`. Every such table has `UNIQUE (tenant_id, id)` so that children can use **composite FKs** `(tenant_id, parent_id) → parent(tenant_id, id)`. Cross-tenant references are therefore impossible at the constraint level. |
| Branch scope | Branch-scoped tables also carry `branch_id uuid NOT NULL` with FK `(tenant_id, branch_id) → branches(tenant_id, id)`. |
| Money | `numeric(14,2)`, INR. Rates per gram `numeric(14,4)`. Weights in grams `numeric(12,3)`. Percentages `numeric(7,4)`. No `float`/`real`/`money` types. |
| Quantities | `integer`. Fractional quantities are excluded (PRD §15). |
| Enumerations | `text` + `CHECK (col IN (...))`. |
| Time | `timestamptz` (UTC). `business_date date` derived in the branch time zone. `financial_year text` like `'2026-27'`. |
| Audit columns | `created_at timestamptz NOT NULL DEFAULT now()`, `created_by uuid` (profile), and on mutable tables `updated_at` (trigger `private.set_updated_at`) and `updated_by`. |
| Soft state | Master data uses `is_active`/`status`. Rows referenced by transactions cannot be deleted (`ON DELETE RESTRICT`). |
| Naming | snake_case. Plural table names. FK columns named `<entity>_id`. |
| Schemas | `public` (tables + exposed RPCs), `private` (helpers, triggers, not exposed through the Data API), `pricing`, `tax` (calculation functions, not exposed). |
| Extensions | `pgcrypto` (UUIDs, hashing), `citext` (case-insensitive emails/names where needed), `pg_trgm` (search), `btree_gist` (exclusion constraints on effective ranges). |

---

## 2. Entity overview

```
tenants ─┬─ tenant_settings (1:1)
         ├─ branches ─┬─ counters ── cash_sessions ─┬─ cash_movements
         │            │                             ├─ invoices ─┬─ invoice_items ─┬─ invoice_item_price_components
         │            │                             │            │                 └─ invoice_item_costs
         │            │                             │            └─ payments
         │            │                             └─ returns ── return_items
         │            ├─ inventory_balances / inventory_movements
         │            ├─ purchase_receipts ── purchase_receipt_lines
         │            └─ stock_adjustments ── stock_adjustment_lines
         ├─ tenant_memberships ── branch_memberships        (profiles ↔ auth.users)
         ├─ roles ── role_permissions ── permissions(global)   role_discount_limits
         ├─ categories, brands, sizes, colours, tax_classes ── tax_rates
         ├─ products ── product_variants ── variant_costs
         ├─ metal_types ── metal_purities ── metal_rates
         ├─ jewellery_designs ── jewellery_items ─┬─ jewellery_item_stones
         │                                       └─ jewellery_item_costs
         ├─ barcode_aliases (→ variant | jewellery item)
         ├─ pricing_rules ── pricing_rule_versions ── pricing_rule_components
         ├─ suppliers, customers, label_templates, label_batches, document_sequences
         ├─ idempotency_keys, approval_grants, document_prints, support_access_grants
         └─ audit_logs
platform_admins, permissions, rate_limit_buckets (global)
```

---

## 3. Platform and tenancy

### 3.1 `tenants`
| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| code | text | UNIQUE, `CHECK (code ~ '^[A-Z0-9]{2,10}$')` — used in URLs and barcode prefixes |
| legal_name, trade_name | text | NOT NULL |
| status | text | `ACTIVE`, `SUSPENDED`, `CLOSED`; default `ACTIVE` |
| gstin | text | NULL, `CHECK (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$')` |
| state_code | char(2) | NULL until configured |
| address_line1, address_line2, city, postal_code | text | |
| logo_path | text | Storage object path `{tenant_id}/branding/…` |
| invoice_header, invoice_footer | text | |
| created_at, created_by, updated_at, updated_by | | |

### 3.2 `tenant_settings` (1:1, PK `tenant_id`)
Nullable settings mean **"not configured"**. Features that depend on them are blocked, which surfaces as a setup checklist, until the owner sets them. This is how open questions are kept out of code.

| Column | Type | Default | Linked OQ |
|---|---|---|---|
| prices_include_tax_clothing | boolean | NULL | OQ-11 |
| prices_include_tax_jewellery | boolean | NULL | OQ-11 |
| invoice_round_off | text `NONE`/`NEAREST_1`/`NEAREST_0_50`/`DOWN_1` | NULL | OQ-08 |
| allow_negative_stock | boolean | false | OQ-25 |
| return_window_days | integer | NULL (returns need manager approval until set) | OQ-19 |
| cash_limit_amount, cash_limit_action (`WARN`/`BLOCK`) | numeric(14,2), text | NULL | OQ-23 |
| pan_required_above | numeric(14,2) | NULL | OQ-23 |
| customer_required_above | numeric(14,2) | NULL (never required) | OQ-24 |
| rate_staleness_policy (`SAME_BUSINESS_DAY`/`MAX_AGE_HOURS`), rate_max_age_hours | text, int | NULL | OQ-02 |
| cash_variance_threshold | numeric(14,2) | NULL (always needs sign-off when ≠ 0) | OQ-22 |
| upi_reference_required, card_reference_required | boolean | false | OQ-22 |
| idle_lock_minutes | integer | 10 | |
| financial_year_start_month | smallint | 4 | OQ-36 |
| feature_flags | jsonb | `'{}'` | |

### 3.3 `branches`
`id`, `tenant_id` FK, `code` (`^[A-Z0-9]{2,8}$`, `UNIQUE (tenant_id, code)`), `name`, address columns, `state_code char(2) NOT NULL`, `gstin`, `phone`, `timezone text NOT NULL DEFAULT 'Asia/Kolkata'`, `invoice_prefix text`, `credit_note_prefix text`, `status` (`ACTIVE`/`INACTIVE`), audit columns. `UNIQUE (tenant_id, id)`.

### 3.4 `counters`
`id`, `tenant_id`, `branch_id` (composite FK), `code`, `name`, `status`. `UNIQUE (branch_id, code)`, `UNIQUE (tenant_id, id)`.

### 3.5 `profiles`
`id uuid PK REFERENCES auth.users(id) ON DELETE RESTRICT`, `full_name text NOT NULL`, `phone text`, `status` (`ACTIVE`/`DISABLED`), timestamps. Created by trigger `private.handle_new_user()` on `auth.users` insert.

### 3.6 `platform_admins`
`user_id uuid PK → profiles`, `granted_by`, `granted_at`, `revoked_at`. Active = `revoked_at IS NULL`.

### 3.7 `support_access_grants`
`id`, `tenant_id`, `platform_admin_user_id`, `granted_by` (tenant owner), `reason text NOT NULL`, `starts_at`, `expires_at` (`CHECK (expires_at <= starts_at + interval '72 hours')`), `revoked_at`, `created_at`. Grants are **read-only**.

---

## 4. Access control

### 4.1 `permissions` (global reference data, inserted by migration)
`key text PK` (for example `sale.create`), `scope` (`TENANT`/`BRANCH`), `description`, `is_sensitive boolean`. The full list is in [SECURITY_MODEL.md](SECURITY_MODEL.md) §4.

### 4.2 `roles`
`id`, `tenant_id uuid NULL` (NULL = system role), `key`, `name`, `scope` (`TENANT`/`BRANCH`), `is_system boolean`. `UNIQUE NULLS NOT DISTINCT (tenant_id, key)`. System roles: `tenant_owner` (TENANT), `tenant_member` (TENANT, minimal), `branch_manager` (BRANCH), `cashier` (BRANCH).

### 4.3 `role_permissions`
`role_id`, `permission_key`. PK both. System role permissions are seeded by migration and immutable for tenants.

### 4.4 `tenant_memberships`
`id`, `tenant_id`, `user_id → profiles`, `role_id` (TENANT-scope role), `status` (`INVITED`/`ACTIVE`/`DISABLED`), `invited_by`, timestamps. `UNIQUE (tenant_id, user_id)`. Index `(user_id, status)`.

### 4.5 `branch_memberships`
`id`, `tenant_id`, `branch_id`, `user_id`, `role_id` (BRANCH-scope role), `status`. `UNIQUE (branch_id, user_id)`. FK `(tenant_id, user_id) → tenant_memberships(tenant_id, user_id)`, so a branch member must be a tenant member. Index `(user_id, status)`.

### 4.6 `role_discount_limits`
PK `(tenant_id, role_id)`. Columns `max_line_discount_pct numeric(7,4)`, `max_invoice_discount_pct numeric(7,4)`, `max_discount_amount numeric(14,2)`. Missing row = 0 (no discount without approval). OQ-21.

### 4.7 `approval_grants`
Single-use manager approvals (TRD §8). `id`, `tenant_id`, `branch_id`, `approver_user_id`, `requested_by`, `action_type` (`DISCOUNT_OVERRIDE`, `RETURN_OUTSIDE_POLICY`, `INVOICE_VOID`, `NEGATIVE_STOCK`, `CASH_VARIANCE`, `CASH_LIMIT_OVERRIDE`), `scope_hash text` (hash of the exact request being approved), `expires_at` (≤ 2 min), `consumed_at`, `created_at`.

---

## 5. Catalogue

### 5.1 `categories`
`id`, `tenant_id`, `parent_id` (composite self-FK, nullable), `name`, `product_kind` (`CLOTHING`/`IMITATION_JEWELLERY`/`PRECIOUS_JEWELLERY`), `default_hsn_code` (`^[0-9]{4,8}$`), `default_tax_class_id`, `sort_order`, `is_active`. `UNIQUE NULLS NOT DISTINCT (tenant_id, parent_id, lower(name))` (expression unique index). The trigger `private.check_category_depth` limits depth to 2, and a child must have the same `product_kind` as its parent.

### 5.2 `brands`
`id`, `tenant_id`, `name`, `is_active`. Unique index `(tenant_id, lower(name))`.

### 5.3 `sizes`, `colours`
`sizes`: `id`, `tenant_id`, `size_group` (for example `ALPHA`, `WAIST`, `FREE`), `code`, `label`, `sort_order`. `UNIQUE (tenant_id, size_group, code)`.
`colours`: `id`, `tenant_id`, `name`, `hex`. Unique index `(tenant_id, lower(name))`.
A default size `FREE` and colour `DEFAULT` are created per tenant, so single-variant products need no extra input (UX plan §5).

### 5.4 `products` (clothing styles)
`id`, `tenant_id`, `category_id` (must be `CLOTHING` kind, enforced by trigger), `brand_id` NULL, `style_code` (`UNIQUE (tenant_id, style_code)`), `name`, `description`, `hsn_code`, `tax_class_id`, `is_active`, audit columns. GIN trigram index on `name`.

### 5.5 `product_variants`
| Column | Type | Constraints |
|---|---|---|
| id, tenant_id | uuid | |
| product_id | uuid | composite FK |
| sku | text | `UNIQUE (tenant_id, sku)` |
| size_id, colour_id | uuid | composite FKs. `UNIQUE NULLS NOT DISTINCT (product_id, size_id, colour_id)` |
| selling_price | numeric(14,2) | `>= 0` |
| mrp | numeric(14,2) | NULL. `CHECK (mrp IS NULL OR mrp >= selling_price)` (OQ-12) |
| tax_class_id | uuid | NULL = inherit from product |
| reorder_level | integer | NULL |
| is_active | boolean | |
| price_updated_at | timestamptz | Set by trigger when `selling_price` changes. Used as the quote basis. |

### 5.6 `variant_costs` (cost-gated)
PK `variant_id`, `tenant_id`, `cost_price numeric(14,2) NOT NULL`, `updated_at`, `updated_by`. Read requires `cost.view`. Kept separate so cost never leaks through catalogue reads. Valuation basis: see A-12.

---

## 6. Jewellery

### 6.1 `metal_types`
`id`, `tenant_id`, `code` (`GOLD`, `SILVER`, `PLATINUM`, `OTHER`), `name`, `is_active`. `UNIQUE (tenant_id, code)`.

### 6.2 `metal_purities`
`id`, `tenant_id`, `metal_type_id`, `code` (for example `22K`), `label`, `fineness numeric(6,3)` (parts per thousand, for example 916.000; `CHECK (fineness > 0 AND fineness <= 1000)`), `is_active`. `UNIQUE (tenant_id, metal_type_id, code)`. Values are configured by the client (OQ-05). Only codes are seeded in dev.

### 6.3 `jewellery_designs`
`id`, `tenant_id`, `kind` (`IMITATION`/`PRECIOUS`), `category_id` (kind must match the category's `product_kind`), `design_code` (`UNIQUE (tenant_id, design_code)`), `name`, `description`, `hsn_code`, `tax_class_id`, `default_metal_type_id`, `default_purity_id`, `default_pricing_rule_id`, `image_path`, `is_active`. GIN trigram index on `name`.

### 6.4 `jewellery_items`
| Column | Type | Constraints / notes |
|---|---|---|
| id, tenant_id | uuid | |
| branch_id | uuid | current location (composite FK) |
| design_id | uuid | composite FK |
| kind | text | `IMITATION`/`PRECIOUS`. Must equal `design.kind` (trigger). |
| tag_code | text | `UNIQUE (tenant_id, tag_code)`. `^[A-Z0-9]{4,20}$`. |
| status | text | `PENDING_RECEIPT`, `IN_STOCK`, `SOLD`, `QC_HOLD`, `DAMAGED`, `WRITTEN_OFF`, (`IN_TRANSIT` reserved for FUT-01) |
| pricing_mode | text | `FIXED_TAG`/`METAL_RATE` |
| tag_price | numeric(14,2) | `CHECK (pricing_mode <> 'FIXED_TAG' OR tag_price IS NOT NULL)` |
| pricing_rule_id | uuid | NULL → design default → category/metal/purity default |
| metal_type_id, purity_id | uuid | |
| gross_weight_g, net_weight_g | numeric(12,3) | |
| hallmark_huid | text | NULL (OQ-07) |
| description_override | text | |
| source_type | text | `PURCHASE`, `OPENING` |
| purchase_receipt_line_id, supplier_id | uuid | |
| sold_invoice_item_id | uuid | Set by checkout. Cleared on return/void. |
| version | integer | Optimistic concurrency for edits |
| audit columns | | |

Table CHECKs:
- `kind = 'PRECIOUS' OR pricing_mode = 'FIXED_TAG'` — imitation items are always fixed-tag.
- `kind = 'IMITATION' OR (metal_type_id IS NOT NULL AND purity_id IS NOT NULL AND gross_weight_g > 0 AND net_weight_g > 0 AND net_weight_g <= gross_weight_g)`.
- Trigger `private.guard_jewellery_item_update`: when `OLD.status = 'SOLD'`, price-affecting columns are immutable. `status` can only be changed by SECURITY DEFINER functions (checked through a transaction-local setting `app.ledger_write = 'on'`).

Indexes: `(tenant_id, branch_id, status)`, `(tenant_id, design_id)`, `(purchase_receipt_line_id)`.

### 6.5 `jewellery_item_stones`
`id`, `tenant_id`, `jewellery_item_id`, `line_no`, `stone_type`, `stone_count int >= 1`, `weight numeric(12,3)`, `weight_unit` (`CT`/`G`), `shape`, `colour`, `clarity`, `quality_note`, `certificate_no`, `charge_amount numeric(14,2) DEFAULT 0 CHECK (>= 0)`, `included_in_gross boolean DEFAULT true`. `UNIQUE (jewellery_item_id, line_no)`. Fields per OQ-06.

### 6.6 `jewellery_item_costs` (cost-gated)
PK `jewellery_item_id`, `tenant_id`, `cost_price numeric(14,2)`, `updated_at`, `updated_by`.

---

## 7. Barcodes — `barcode_aliases`

A single registry for **all** scannable codes (primary and alias), so uniqueness holds across variants and jewellery items.

| Column | Type | Constraints |
|---|---|---|
| id, tenant_id | uuid | |
| code | text | `UNIQUE (tenant_id, code)`. Uppercase, trimmed (`CHECK (code = upper(btrim(code)) AND length(code) BETWEEN 4 AND 48)`). Codes are never reused, even after deactivation. |
| symbology | text | `CODE128`, `EAN13`, `UPCA`, `QR`, `OTHER` |
| target_type | text | `VARIANT`/`JEWELLERY_ITEM` |
| variant_id, jewellery_item_id | uuid | `CHECK (num_nonnulls(variant_id, jewellery_item_id) = 1)` and consistent with `target_type` |
| is_primary | boolean | partial unique `(variant_id) WHERE is_primary`, `(jewellery_item_id) WHERE is_primary` |
| source | text | `SYSTEM`, `SUPPLIER`, `MANUAL` |
| is_active | boolean | |

**Exact match only.** `resolve_barcode` looks up `WHERE tenant_id = $1 AND code = upper(btrim($2))`. Barcode resolution never uses `LIKE`/trigram (UX plan §3, TC-BAR-02).

---

## 8. Tax configuration

### 8.1 `tax_classes`
`id`, `tenant_id`, `code` (`UNIQUE (tenant_id, code)`), `name`, `description`, `is_active`.

### 8.2 `tax_rates`
`id`, `tenant_id`, `tax_class_id`, `effective_from date NOT NULL`, `effective_to date NULL`, `min_unit_value numeric(14,2) NULL`, `max_unit_value numeric(14,2) NULL`, `gst_rate_pct numeric(7,4) NOT NULL CHECK (0..100)`, `cess_rate_pct numeric(7,4) DEFAULT 0`, `notes`, `created_by`, `created_at`.
Exclusion constraint (btree_gist): no overlapping `daterange(effective_from, effective_to, '[)')` × `numrange(min_unit_value, max_unit_value, '[)')` per `tax_class_id`.
**No production rates are seeded** (OQ-10). Billing an item whose class has no effective rate fails with `TAX_NOT_CONFIGURED`.

HSN codes are stored as text on categories (default), products and designs (override), and snapshotted on invoice lines.

---

## 9. Pricing

### 9.1 `metal_rates` (immutable)
`id`, `tenant_id`, `metal_type_id`, `purity_id`, `entered_rate numeric(14,4)`, `entered_unit` (`PER_GRAM`/`PER_10_GRAM`/`PER_KG`), `rate_per_gram numeric(14,4) NOT NULL CHECK (> 0)` (normalized from the entered rate in the RPC), `effective_from timestamptz NOT NULL`, `source text`, `note`, `created_by`, `created_at`. `UNIQUE (tenant_id, purity_id, effective_from)`. Index `(tenant_id, purity_id, effective_from DESC)`. UPDATE/DELETE are blocked by trigger.

### 9.2 `pricing_rules` (rule families)
`id`, `tenant_id`, `name`, `applies_metal_type_id`, `applies_purity_id NULL`, `applies_category_id NULL`, `is_default boolean`, `is_active`. Partial unique: one default per `(tenant_id, applies_metal_type_id, applies_purity_id, applies_category_id) WHERE is_default AND is_active` (NULLS NOT DISTINCT).

### 9.3 `pricing_rule_versions`
`id`, `tenant_id`, `pricing_rule_id`, `version int`, `status` (`DRAFT`/`ACTIVE`/`RETIRED`), `rounding_increment numeric(14,2) NULL`, `rounding_mode` (`NONE`/`HALF_UP`/`UP`/`DOWN`), `notes`, `approved_example_ref text` (reference to the signed worked-example sheet, FR-PRC-07), `activated_by`, `activated_at`, `retired_at`, audit columns. `UNIQUE (pricing_rule_id, version)`. Partial unique `(pricing_rule_id) WHERE status = 'ACTIVE'`. Trigger: ACTIVE/RETIRED versions and their components are immutable.

### 9.4 `pricing_rule_components`
`id`, `tenant_id`, `pricing_rule_version_id`, `seq smallint`, `component_type`, `basis`, `value numeric(14,4)`, `min_amount`, `max_amount` (numeric(14,2)), `label text NOT NULL`, `is_taxable boolean DEFAULT true`, `tax_class_id NULL`, `discountable boolean DEFAULT true`. `UNIQUE (pricing_rule_version_id, seq)`. Allowed type/basis pairs are enforced by a CHECK matching TRD §11.3.

---

## 10. Inventory

### 10.1 `inventory_balances` (projection)
PK `(branch_id, variant_id, bucket)`. Columns `tenant_id`, `bucket` (`SELLABLE`/`QC_HOLD`/`DAMAGED`), `on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0)`, `last_movement_id bigint`, `updated_at`.
If the client approves negative stock (OQ-25), a migration replaces the CHECK with function-level enforcement. Until then, the constraint is the final guard.

### 10.2 `inventory_movements` (append-only ledger)
| Column | Type | Notes |
|---|---|---|
| id | bigint identity | PK, monotonic |
| tenant_id, branch_id | uuid | |
| movement_type | text | `OPENING`, `PURCHASE_RECEIPT`, `PURCHASE_CANCEL`, `SALE`, `SALE_VOID`, `SALE_RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `BUCKET_MOVE` (reserved `TRANSFER_OUT`, `TRANSFER_IN`) |
| item_type | text | `VARIANT`/`JEWELLERY_ITEM` |
| variant_id, jewellery_item_id | uuid | exactly one non-null |
| bucket | text | `SELLABLE`/`QC_HOLD`/`DAMAGED` |
| quantity_delta | integer | `<> 0`. Jewellery: ±1. |
| balance_after | integer | variant only |
| unit_cost | numeric(14,2) | NULL |
| reference_type, reference_id, reference_line_id | text, uuid, uuid | source document |
| reason_code, note | text | |
| business_date | date | |
| created_by, created_at | | |

No INSERT/UPDATE/DELETE grant for `authenticated`. Rows are written only by `private.apply_variant_movement()` / `private.apply_item_movement()` inside SECURITY DEFINER RPCs. Indexes: `(tenant_id, branch_id, variant_id, id)`, `(tenant_id, jewellery_item_id, id)`, `(tenant_id, branch_id, business_date)`, `(reference_type, reference_id)`.

**Invariant:** for each (branch, variant, bucket), `on_hand = Σ quantity_delta`. For each jewellery item, the bucket of the last movement corresponds to its status (`IN_STOCK`→SELLABLE, `QC_HOLD`→QC_HOLD, `DAMAGED`→DAMAGED, otherwise net 0 at the branch).

### 10.3 `stock_adjustments`, `stock_adjustment_lines`
Header: `id`, `tenant_id`, `branch_id`, `adjustment_number` (sequence, assigned on post), `status` (`DRAFT`/`PENDING_APPROVAL`/`POSTED`/`REJECTED`), `reason_code` (`COUNT_CORRECTION`, `DAMAGE`, `LOSS`, `FOUND`, `QC_RELEASE`, `WRITE_OFF`, `OTHER`), `note`, `created_by`, `submitted_at`, `approved_by`, `approved_at`, `posted_at`, `idempotency_key`.
Lines: `id`, `tenant_id`, `stock_adjustment_id`, `line_no`, `item_type`, `variant_id`, `jewellery_item_id`, `from_bucket`, `to_bucket` (for moves), `quantity_delta`, `note`.

---

## 11. Suppliers and purchases

### 11.1 `suppliers`
`id`, `tenant_id`, `name` (unique `(tenant_id, lower(name))`), `gstin`, `state_code`, `phone`, `email`, address columns, `is_active`.

### 11.2 `purchase_receipts`
`id`, `tenant_id`, `branch_id`, `receipt_number` (NULL until posted, `UNIQUE (tenant_id, branch_id, receipt_number)`), `supplier_id`, `supplier_invoice_no`, `supplier_invoice_date`, `status` (`DRAFT`/`POSTED`/`CANCELLED`), `subtotal`, `tax_total`, `total`, `notes`, `posted_by/at`, `cancelled_by/at`, `cancel_reason`, `idempotency_key`. Partial unique `(tenant_id, supplier_id, supplier_invoice_no) WHERE status <> 'CANCELLED' AND supplier_invoice_no IS NOT NULL` prevents entering the same supplier bill twice.

### 11.3 `purchase_receipt_lines`
`id`, `tenant_id`, `purchase_receipt_id`, `line_no`, `line_type` (`VARIANT`/`JEWELLERY_ITEM`), `variant_id`, `quantity int > 0`, `jewellery_design_id`, `unit_cost`, `tax_rate_pct`, `tax_amount`, `line_total`. Jewellery items in a draft receipt exist as `jewellery_items` rows with status `PENDING_RECEIPT` linked through `purchase_receipt_line_id`. Posting moves them to `IN_STOCK` and writes movements. Deleting a draft line deletes its pending items. Pending items are never sellable or counted.

### 11.4 Branch transfers — **designed, not migrated in Release 1.0** (FUT-01)
`stock_transfers` (`id`, `tenant_id`, `from_branch_id`, `to_branch_id`, `transfer_number`, `status` `DRAFT`/`DISPATCHED`/`RECEIVED`/`CANCELLED`, `dispatched_by/at`, `received_by/at`, `note`) and `stock_transfer_lines` (`item_type`, `variant_id`, `jewellery_item_id`, `quantity_sent`, `quantity_received`). These will use `TRANSFER_OUT`/`TRANSFER_IN` movements and the `IN_TRANSIT` item status. They are created by a Phase 10 migration.

---

## 12. Sales

### 12.1 `customers`
`id`, `tenant_id`, `name`, `phone` (normalized digits; partial unique `(tenant_id, phone) WHERE phone IS NOT NULL`), `email`, `gstin`, `state_code`, address columns, `pan_last4` (only if OQ-23 requires PAN capture; the full PAN is never stored unless the client confirms the legal need), `consent_at`, `anonymised_at`. **Optional on invoices.** Walk-in sales have `customer_id NULL` (UX plan §3).

### 12.2 `cash_sessions`
`id`, `tenant_id`, `branch_id`, `counter_id`, `business_date`, `status` (`OPEN`/`CLOSED`), `opened_by`, `opened_at`, `opening_float numeric(14,2) >= 0`, `closed_by`, `closed_at`, `expected_cash`, `counted_cash`, `variance`, `denomination_counts jsonb`, `variance_approved_by`, `close_note`. Partial unique `(counter_id) WHERE status = 'OPEN'`.

### 12.3 `cash_movements`
`id`, `tenant_id`, `branch_id`, `cash_session_id`, `movement_type` (`PAY_IN`/`PAY_OUT`), `amount > 0`, `reason`, `created_by`, `created_at`.

### 12.4 `document_sequences`
`id`, `tenant_id`, `branch_id NULL`, `document_type` (`INVOICE`, `CREDIT_NOTE`, `GRN`, `ADJUSTMENT`, `BARCODE`, `TAG_IMITATION`, `TAG_PRECIOUS`), `financial_year text NULL`, `prefix`, `next_number bigint NOT NULL DEFAULT 1`, `padding smallint`. `UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, document_type, financial_year)`. Rows are created lazily inside the allocating transaction (`INSERT … ON CONFLICT DO NOTHING` then `UPDATE … RETURNING`).

### 12.5 `idempotency_keys`
PK `(tenant_id, scope, key)`. `scope` (`checkout`, `void`, `return`, `exchange`, `grn_post`, `adjustment_post`, `cash_close`, `payment_correct`, …), `key uuid`, `request_hash text NOT NULL` (SHA-256 of the canonical request), `actor_user_id`, `status` (`PENDING`/`COMPLETED`), `result_entity_id`, `response jsonb`, `created_at`, `completed_at`. Rows are purged after 90 days. `invoices.idempotency_key` is permanently unique as a second guard.

### 12.6 `invoices`
| Column | Type | Notes |
|---|---|---|
| id, tenant_id, branch_id, counter_id, cash_session_id | uuid | composite FKs |
| invoice_number | text | `≤ 16 chars`. `UNIQUE (tenant_id, branch_id, financial_year, invoice_number)` |
| financial_year, business_date, issued_at | | |
| cashier_user_id | uuid | |
| customer_id | uuid | NULL for walk-in |
| customer_name, customer_phone, customer_gstin, customer_address, customer_pan_last4 | text | snapshot |
| place_of_supply_state_code | char(2) | defaults to the branch state |
| is_inter_state | boolean | |
| status | text | `ISSUED`/`VOIDED` |
| gross_total, discount_total, taxable_total, cgst_total, sgst_total, igst_total, cess_total, tax_total, round_off, grand_total, paid_total, change_total | numeric(14,2) | `CHECK (grand_total = taxable_total + tax_total + round_off)`, `CHECK (tax_total = cgst_total + sgst_total + igst_total + cess_total)` |
| idempotency_key | uuid | `UNIQUE (tenant_id, idempotency_key)` |
| voided_at, voided_by, void_reason, void_approval_id | | |
| notes, created_at | | |

Immutable except the void columns, which only `pos_void_invoice` sets (enforced by trigger). Indexes: `(tenant_id, branch_id, business_date DESC)`, `(tenant_id, customer_id)`, `(cash_session_id)`.

### 12.7 `invoice_items`
`id`, `tenant_id`, `invoice_id`, `line_no`, `item_type` (`VARIANT`/`JEWELLERY_ITEM`), `variant_id`, `jewellery_item_id`, `product_kind`, `description` (snapshot), `code_snapshot` (SKU or tag), `hsn_code`, `quantity int > 0` (jewellery = 1, CHECK), `unit_price`, `pricing_mode` (`VARIANT_PRICE`/`FIXED_TAG`/`METAL_RATE`), `price_includes_tax boolean`, `gross_amount`, `discount_amount`, `discount_reason`, `taxable_value`, `tax_class_id`, `gst_rate_pct`, `cgst_amount`, `sgst_amount`, `igst_amount`, `cess_amount`, `line_total`.
Precious snapshot: `metal_type_code`, `purity_code`, `fineness`, `gross_weight_g`, `net_weight_g`, `metal_rate_id`, `metal_rate_per_gram`, `pricing_rule_id`, `pricing_rule_version_id`, `pricing_rule_version`, `hallmark_huid`, `stones_snapshot jsonb`.
`line_status` (`SOLD`/`RETURNED`/`VOIDED`) is the only mutable column, changed only by RPCs.
Partial unique `(jewellery_item_id) WHERE line_status = 'SOLD'` is the second guard against double sale.

### 12.8 `invoice_item_price_components`
`id`, `tenant_id`, `invoice_item_id`, `seq`, `component_type`, `label`, `basis`, `basis_quantity numeric(14,4)`, `rate_or_value numeric(14,4)`, `amount numeric(14,2)`, `is_taxable`, `discountable`. Immutable.

### 12.9 `invoice_item_costs` (cost-gated)
PK `invoice_item_id`, `tenant_id`, `unit_cost`, `total_cost`.

### 12.10 `payments` (immutable ledger)
| Column | Notes |
|---|---|
| id, tenant_id, branch_id, cash_session_id | |
| invoice_id / return_id | `CHECK (num_nonnulls(invoice_id, return_id) = 1)` |
| direction | `IN`/`OUT` |
| purpose | `SALE`, `REFUND`, `VOID_REVERSAL`, `CORRECTION_REVERSAL`, `CORRECTION` |
| method | `CASH`, `UPI`, `CARD` |
| amount | `> 0` |
| tendered_amount, change_amount | cash only (`CHECK (method = 'CASH' OR (tendered_amount IS NULL AND change_amount IS NULL))`) |
| reference_no, card_last4 | `card_last4 ~ '^[0-9]{4}$'`. A full card number is never stored. |
| corrects_payment_id | for reversal/correction rows |
| recorded_by, recorded_at, note | |

### 12.11 `returns`, `return_items`
`returns`: `id`, `tenant_id`, `branch_id` (must equal the original invoice's branch at launch), `counter_id`, `cash_session_id`, `original_invoice_id`, `credit_note_number` (`UNIQUE (tenant_id, branch_id, financial_year, credit_note_number)`), `financial_year`, `business_date`, `return_type` (`RETURN`/`EXCHANGE`), `exchange_invoice_id`, `reason_code`, `reason_note`, customer snapshot, `taxable_total`, `cgst_total`, `sgst_total`, `igst_total`, `cess_total`, `round_off`, `credit_total`, `refund_total`, `approval_id`, `idempotency_key` (unique per tenant), `created_by`, `created_at`.
`return_items`: `id`, `tenant_id`, `return_id`, `invoice_item_id`, `line_no`, `quantity > 0`, `disposition` (`RESTOCK`/`QC_HOLD`/`DAMAGED`), `taxable_value`, `cgst_amount`, `sgst_amount`, `igst_amount`, `cess_amount`, `line_total`, `note`. The `pos_return` function enforces Σ returned quantity ≤ sold quantity per invoice line while holding `FOR UPDATE` on the invoice line.

### 12.12 Labels and printing
`label_templates`: `id`, `tenant_id`, `name`, `applies_to_kind`, `width_mm numeric(6,2)`, `height_mm`, `gap_mm`, `columns smallint`, `dpi smallint`, `fields jsonb` (validated by the app against a versioned schema), `barcode_symbology`, `is_default`, `is_active`.
`label_batches`: `id`, `tenant_id`, `branch_id`, `template_id`, `source_type` (`PRODUCT`/`GRN`/`SELECTION`), `source_id`, `created_by`, `created_at`. `label_batch_lines`: `batch_id`, `variant_id`/`jewellery_item_id`, `quantity`.
`document_prints`: `id`, `tenant_id`, `branch_id`, `document_type` (`INVOICE`/`CREDIT_NOTE`/`Z_REPORT`/`LABEL_BATCH`), `document_id`, `format`, `is_reprint`, `printed_by`, `printed_at`.

---

## 13. Audit and operational tables

### 13.1 `audit_logs` (append-only)
`id bigint identity`, `tenant_id NULL`, `branch_id NULL`, `occurred_at timestamptz DEFAULT now()`, `actor_user_id`, `actor_type` (`USER`/`PLATFORM_ADMIN`/`SYSTEM`), `action text` (for example `sale.void`), `entity_type`, `entity_id uuid`, `before jsonb`, `after jsonb`, `reason`, `request_id`, `metadata jsonb`.
`REVOKE UPDATE, DELETE, TRUNCATE` from every application role. A `BEFORE UPDATE OR DELETE` trigger raises an error, so `service_role` is blocked too. Indexes: `(tenant_id, occurred_at DESC)`, `(tenant_id, entity_type, entity_id)`, `(tenant_id, actor_user_id, occurred_at DESC)`.
Population: generic trigger `private.audit_row_change()` on master-data tables (prices, costs, tax, rules, rates, memberships, settings), plus explicit inserts inside financial RPCs.

### 13.2 `rate_limit_buckets`
UNLOGGED table. `key text PK` (for example `checkout:{user_id}`), `window_start timestamptz`, `count int`. Managed by `private.rate_limit_hit(key, limit, window)`.

---

## 14. Row Level Security

### 14.1 Helper functions (schema `private`, `STABLE SECURITY DEFINER SET search_path = ''`)

```sql
create function private.is_platform_admin() returns boolean ...
  -- exists active row in public.platform_admins for (select auth.uid())

create function private.has_tenant_access(p_tenant uuid) returns boolean ...
  -- tenant ACTIVE and (active tenant_membership for auth.uid()
  --   or active, unexpired support_access_grant for auth.uid())   -- read-only use

create function private.is_tenant_owner(p_tenant uuid) returns boolean ...

create function private.has_tenant_permission(p_tenant uuid, p_perm text) returns boolean ...
  -- via tenant role, or owner

create function private.has_branch_access(p_branch uuid) returns boolean ...
  -- owner of branch's tenant, or active branch_membership, tenant ACTIVE, branch ACTIVE

create function private.has_branch_permission(p_branch uuid, p_perm text) returns boolean ...

create function private.assert_branch_permission(p_branch uuid, p_perm text) returns void ...
  -- raises FORBIDDEN; also rejects support-access sessions for writes
```

Support-access grants never satisfy the `has_*_permission` write checks. They provide `SELECT` only.

### 14.2 Policy matrix

| Table(s) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| tenants | `has_tenant_access(id)` or platform admin (metadata view only) | RPC (platform admin) | `has_tenant_permission(id,'settings.manage')` | none |
| tenant_settings | `has_tenant_access` | RPC | `settings.manage` + `aal2` (checked in RPC) | none |
| branches, counters | `has_tenant_access` (owner) or `has_branch_access(id)` | `branch.manage` | `branch.manage` | none |
| profiles | self, or shares a tenant (via `private.shares_tenant`) | trigger only | self (`full_name`, `phone`) | none |
| tenant_memberships, branch_memberships | own rows, or `staff.manage` in tenant | RPC `user_invite` | RPC | none |
| roles, role_permissions, permissions | authenticated (system) / tenant members (tenant roles) | none at launch | none | none |
| role_discount_limits | tenant members | `staff.manage` | `staff.manage` | `staff.manage` |
| categories, brands, sizes, colours, products, product_variants, jewellery_designs, label_templates, suppliers | `has_tenant_access` | `product.create` / `product.edit` (`supplier.manage` for suppliers) | same + price-column guard trigger requires `product.price_edit` | none (deactivate) |
| variant_costs, jewellery_item_costs, invoice_item_costs | `has_tenant_permission(tenant,'cost.view')` | `cost.manage` / RPC | `cost.manage` | none |
| jewellery_items, jewellery_item_stones | `has_tenant_access` and (`is_tenant_owner` or `has_branch_access(branch_id)`) | RPC only | RPC `jewellery_item_update` (`product.edit`) | RPC (draft only) |
| barcode_aliases | `has_tenant_access` | `product.create` / `product.edit` (alias) / RPC (system) | `product.create` / `product.edit` (`is_active` only) | none |
| tax_classes, tax_rates | `has_tenant_access` | `tax.manage` | `tax.manage` (`effective_to` only) | none |
| metal_types, metal_purities | `has_tenant_access` | `pricing.manage` | `pricing.manage` | none |
| metal_rates | `has_tenant_access` | RPC `metal_rate_create` (`metal_rate.set`) | none | none |
| pricing_rules, versions, components | `has_tenant_access` | `pricing.manage` (drafts) | `pricing.manage` (drafts only; activation via RPC, owner + aal2) | drafts only |
| inventory_balances | `has_branch_access(branch_id)` | none | none | none |
| inventory_movements | `has_branch_permission(branch_id,'inventory.view')` | none | none | none |
| stock_adjustments(+lines) | `has_branch_permission(…,'inventory.view')` | `inventory.adjust` (draft) | draft only by creator / RPC | draft only |
| purchase_receipts(+lines) | `has_branch_permission(…,'purchase.view')` | `purchase.manage` (draft) | draft only | draft only |
| customers | `has_tenant_access` (phone masked via view `customers_masked` for users without `customer.view`) | RPC (checkout) or `customer.manage` | `customer.manage` | none (anonymise RPC) |
| cash_sessions, cash_movements | `has_branch_access` | RPC | RPC | none |
| invoices, invoice_items, invoice_item_price_components, payments, returns, return_items | `has_branch_permission(branch_id,'sale.view')` (cashier: same branch) | RPC only | RPC only | none |
| document_sequences, idempotency_keys, approval_grants, rate_limit_buckets | none (RPC/private only) | none | none | none |
| document_prints, label_batches | `has_branch_access` | RPC | none | none |
| support_access_grants | owner of tenant; the named platform admin | RPC (owner + aal2) | RPC (revoke) | none |
| audit_logs | `has_tenant_permission(tenant,'audit.view')` | none (triggers/RPCs) | none | none |

"RPC only" = no table privilege for `authenticated`. All writes go through a SECURITY DEFINER function that calls `private.assert_*`. `anon` has **no** privileges on any table.

Example policy:

```sql
alter table public.invoices enable row level security;
create policy invoices_select on public.invoices for select to authenticated
  using ( private.has_branch_permission(branch_id, 'sale.view') );
revoke insert, update, delete on public.invoices from authenticated, anon;
```

---

## 15. Transaction boundaries

| RPC (all SECURITY DEFINER, one transaction each) | Locks (in order) | Writes |
|---|---|---|
| `pos_checkout` | idempotency row → jewellery items by id → balances by variant_id → sequence | invoices, invoice_items, components, costs, payments, customers (optional), jewellery_items.status, movements, balances, audit, idempotency |
| `pos_void_invoice` | invoice FOR UPDATE → items → balances | invoice status, invoice_items.line_status, reversing movements, `VOID_REVERSAL` payments, audit |
| `pos_return` | original invoice lines FOR UPDATE → items/balances → sequence | returns, return_items, refund payments, movements, line_status, audit |
| `pos_exchange` | union of return + checkout order | return + new invoice + net payments |
| `purchase_receipt_post` / `_cancel` | receipt FOR UPDATE → balances → sequence | status, items `IN_STOCK`, movements, audit |
| `stock_adjustment_post` | adjustment → items → balances → sequence | movements, status, audit |
| `cash_session_open` / `_close` | counter row FOR UPDATE / session FOR UPDATE | session, audit |
| `payment_method_correct` | invoice + session FOR UPDATE | reversal + correction payments, audit |
| `metal_rate_create` | none (insert) | metal_rates, audit |
| `pricing_rule_activate` | rule family FOR UPDATE | version status, audit |
| `import_apply` | per batch, single transaction | master data, opening movements |

---

## 16. Indexing summary

- Every FK column is indexed (CI query checks for unindexed FKs).
- Tenant-leading composite indexes on all list screens (`(tenant_id, …)`).
- Trigram GIN: `products.name`, `jewellery_designs.name`, `product_variants.sku`, `jewellery_items.tag_code` (for **search**, never for barcode resolution).
- Partial indexes: open cash session per counter, active pricing version, `jewellery_items (tenant_id, branch_id) WHERE status = 'IN_STOCK'`.

---

## 17. Migration map

| Logical ID | File (timestamp assigned at creation) | Content | Phase |
|---|---|---|---|
| M0001 | `…_foundation.sql` | extensions, schemas `private/pricing/tax`, `set_updated_at`, base grants/revokes | 1/2 |
| M0002 | `…_tenancy.sql` | tenants, tenant_settings, branches, counters, profiles, platform_admins, permissions, roles, role_permissions, memberships, role_discount_limits, support_access_grants, approval_grants + permission/role seed data | 2 |
| M0003 | `…_tenancy_rls.sql` | helper functions + RLS for M0002 tables | 2 |
| M0004 | `…_audit.sql` | audit_logs, append-only trigger, `audit_row_change`, rate_limit_buckets | 2 |
| M0005 | `…_catalogue_tax.sql` | categories, brands, sizes, colours, tax_classes, tax_rates, products, product_variants, variant_costs + RLS + guards | 3 |
| M0006 | `…_jewellery.sql` | metal_types, metal_purities, jewellery_designs, jewellery_items, stones, costs + RLS | 3 |
| M0007 | `…_barcodes.sql` | barcode_aliases, document_sequences, `resolve_barcode` | 3/4 |
| M0008 | `…_inventory_ledger.sql` | inventory_balances, inventory_movements, apply_* functions, stock_adjustments + RLS | 3 |
| M0009 | `…_pricing.sql` | metal_rates, pricing_rules, versions, components, `pricing.*`, `tax.*`, `quote_cart` | 5 |
| M0010 | `…_sales.sql` | customers, cash_sessions, cash_movements, idempotency_keys, invoices, invoice_items, components, costs, payments, document_prints, label tables, `pos_checkout`, `pos_void_invoice`, cash RPCs | 6 |
| M0011 | `…_purchases_returns.sql` | suppliers, purchase_receipts, lines, returns, return_items, `pos_return`, `pos_exchange`, GRN RPCs, adjustment RPCs | 7 |
| M0012 | `…_reporting.sql` | `security_invoker` reporting views and functions, supporting indexes | 8 |
| (Phase 10) | `…_branch_transfers.sql` | stock_transfers, lines, transfer RPCs | 10 |

---

## 18. Deviations from the requested table list (justified)

| Requested | Design | Reason |
|---|---|---|
| `barcode_aliases` | One registry holding **primary and alias** codes | Guarantees tenant-wide uniqueness across variants and items with a single unique index |
| roles and permissions | `roles`, `permissions`, `role_permissions`, `role_discount_limits` | Normalized permission sets. Discount limits per role. |
| purchase records | `purchase_receipts` + `purchase_receipt_lines` (GRN) | Launch needs receiving, not purchase orders (FUT-12) |
| `pricing_rules` | `pricing_rules` (family) → `pricing_rule_versions` → `pricing_rule_components` | Immutable versions give exact historical snapshots. Items reference the family, so new versions apply automatically. |
| metal rates | + `metal_types`, `metal_purities` | Purity conventions are client-configurable (OQ-05) |
| tax configuration | `tax_classes` + effective-dated `tax_rates` with value slabs | Rates change over time and some depend on unit value |
| inventory_balances | Per **bucket** (sellable / QC hold / damaged) | Returned or damaged goods must not be sellable but must be tracked |
| cost fields | Separate cost tables | Cost visibility is permission-gated without column-level privileges (OQ-26) |
| branch transfers | Designed, not migrated at launch | Future phase only |
| Additions | `counters`, `tenant_settings`, `customers`, `cash_movements`, `document_sequences`, `idempotency_keys`, `approval_grants`, `support_access_grants`, `platform_admins`, `stock_adjustments`, `label_templates/batches`, `document_prints`, `rate_limit_buckets` | Required by PRD functions and safeguards |
