# NexVelt RetailOS — Security Model

| Field | Value |
|---|---|
| Document ID | NXR-SEC |
| Version | 0.2 |
| Date | 2026-10-10 |
| Related | [TRD](TRD.md) §7, §8, §18 · [Database Design](DATABASE_DESIGN.md) §4, §14 · [API Specification](API_SPECIFICATION.md) · [Test Strategy](TEST_STRATEGY.md) |

**Honest status:** this is the *design*. Today only application-level rules are implemented and unit-tested (strict input schemas, server-side permission checks, discount authority, fail-closed backend, exact barcode matching). **No authentication, no tenant isolation, no database, no RLS and no audit log exist yet** (Phase 2/3). Nothing in this document should be read as "already secure".

---

## 1. Principles
1. **Defence in depth:** URL scoping → server guards → strict validation → RPC re-checks → RLS → constraints. A single failed layer must not expose data.
2. **Deny by default:** no permission, no discount authority, no configured backend, no configured tax or rule means *no action*, not a guess.
3. **The browser is untrusted:** it supplies intent only (which item, how many, how paid). It never supplies a price, total, tax, role, tenant or branch.
4. **Money-moving writes happen only inside database functions** that authorise, lock, validate and audit in one transaction.
5. **Least privilege everywhere:** roles, database grants, secrets, support access.
6. **Everything important is attributable:** individual logins and an append-only audit trail.
7. **Do not trust that RLS "is on".** Every policy is proven by negative tests.

## 2. Assets and threats
| Asset | Threat | Primary controls |
|---|---|---|
| Sales, stock, customers of tenant A | Read or modified by tenant B | Composite FKs, RLS, server tenant resolution, negative tests |
| Branch data | Staff of branch 1 act in branch 2 | Branch memberships, `has_branch_permission`, RLS |
| Prices and totals | Tampered request | Strict schemas, server re-pricing, `PRICE_STALE`, `expectedTotal` check |
| Invoice integrity | Edited after issue | No UPDATE grants, immutability triggers, void/credit-note flow |
| Cash and payments | Fake "paid" status, skimming | Cashier confirmation, immutable payment ledger, session reconciliation, audit |
| Stock integrity | Double sale, oversell | Row locks, unique indexes, ledger invariants |
| Credentials and keys | Leak to the browser or the repository | Server-only env, `NEXT_PUBLIC_` guard, secret scanning |
| Customer personal data | Over-collection, leak | Minimisation, masking, no PII in logs, retention policy |
| Availability | Abuse, brute force | Rate limits, MFA, provider protections, backups |

## 3. Tenant isolation and branch-scoped access

### 3.1 Layers
| Layer | Mechanism | Status |
|---|---|---|
| Routing | `/t/{tenant}/b/{branch}`; codes resolved to IDs on the server; membership verified on every request | Spec |
| Server guard | `requireTenant`, `requireBranch(permission)` run in every page and action | Spec |
| Schema | Every tenant table has `tenant_id`; child FKs are composite `(tenant_id, parent_id)` | Spec |
| RLS | `has_tenant_access`, `has_branch_access`, `has_*_permission` helper functions in policies on every table | Spec |
| Functions | SECURITY DEFINER RPCs call `assert_branch_permission` first; `SET search_path = ''` | Spec |
| Storage | Object path prefix `{tenant_id}/` + storage policies using the same helpers | Spec |
| Tests | pgTAP negative suite on every pull request | Spec |

### 3.2 Branch rules
- A user sees and acts only in branches where they hold an **active** branch membership. Tenant owners implicitly cover all branches of their tenant.
- Inventory, sales, cash sessions, receipts and adjustments carry `branch_id`. Reads and writes are filtered by RLS.
- Master data (catalogue, tax, rules, rates) is tenant-wide (A-05).
- A suspended tenant or inactive branch blocks all operations immediately (the helper functions return false).

## 4. Role–permission matrix

`●` = allowed, `○` = allowed with conditions (see notes), blank = denied. **Permissions are what the code checks; roles are only bundles.** Implemented today (demo, in `src/domain/navigation.ts` and `policy.ts`): `sale.create`, `sale.view`, `catalog.view`, `inventory.view`, `report.view`, `settings.*` for navigation, and discount authority. The rest are specification.

| Permission | Platform admin | Tenant owner | Branch manager | Cashier | Notes |
|---|:-:|:-:|:-:|:-:|---|
| `platform.tenant.create/suspend` | ● | | | | aal2 |
| Tenant business data (any) | ○ | ● | | | Platform admin only through an owner-granted, time-limited, read-only support grant |
| `settings.manage` (profile, settings, tax) | | ● | | | aal2 for tax settings |
| `branch.manage` (branches, counters) | | ● | ○ | | Manager: own branch counters only |
| `staff.manage` (invite, disable, roles) | | ● | | | |
| `sale.create` | | ● | ● | ● | Branch scoped; needs an open cash session |
| Discount without approval | | ● (unlimited) | ○ limit TBD (OQ-21, currently 0) | ○ limit TBD (currently 0) | Enforced in the engine. Default deny. |
| Approve discount/return/void on the counter | | ● | ● | | Single-use token, manager credentials re-entered |
| `product.price_edit` (selling prices) | | ● | ○ per OQ-38 | | Cashier: **never** |
| `cost.view` / `cost.manage` | | ● | ○ OQ-26 | | Costs live in separate gated tables |
| `product.create` / `product.edit` (products, barcodes) | | ● | ● | | |
| `product.edit` | | ● | ● | | Not after the item is sold |
| `metal_rate.set` | | ● | ○ per OQ-02 | | Immutable rows |
| `pricing.manage` / activate rule | | ● (activate, aal2) | ○ drafts | | |
| `tax.manage` | | ● | | | aal2 |
| `purchase.manage` / `purchase.manage` | | ● | ● | | Cancel: manager |
| `inventory.view` | | ● | ● | ○ | Cashier: stock lookup only |
| `inventory.adjust` / `.approve` | | ● | ● | ○ request only | |
| `sale.view` | | ● | ● | ○ | Cashier: own branch, current day |
| `sale.view` | | ● | ● | ○ | Marked DUPLICATE, logged |
| `sale.void` | | ● | ● | | Same business day, open session (OQ-34) |
| `sale.return` | | ● | ● | ○ | Outside policy needs approval |
| `payment.refund` | | ● | ● | | Open session only; audited |
| `cash.session.open/close` | | ● | ● | ● | Variance sign-off by manager |
| `report.view` | | ● | ● | | Branch scoped for managers |
| `report.export` | | ● | ○ | | Audited |
| `audit.view` | | ● | | | |
| `settings.manage` | | ● | ● | | Printer/label preferences |
| `customer.view` | | ● | ● | | Others see masked phone |

## 5. Platform administrator boundaries
- Platform admins manage **tenants**, not tenant **data**. They have no SELECT policy on business tables.
- Support access = `support_access_grants` row created by the tenant owner (aal2), ≤ 72 hours, **read-only**, with a stated reason. Every read under a grant is audited as `PLATFORM_ADMIN`.
- Platform admin accounts require MFA (aal2), are few, named, and reviewed quarterly.
- Platform admins cannot approve a tenant's discounts, void invoices or change tenant prices.
- The Supabase dashboard / service credentials are an operations-level break-glass path: held by named operators, used only with a written reason, and every use is recorded in the operations log (see Runbook).

## 6. Row Level Security: policies and negative tests

The policy matrix is in [DATABASE_DESIGN.md](DATABASE_DESIGN.md) §14. Rules for authors:

1. RLS enabled and `FORCE`d in the same migration that creates the table. CI fails on any `public` table with RLS off.
2. No policy contains a raw `user_id =` check that bypasses the helpers, except on profile/self rows.
3. Helper functions: `STABLE SECURITY DEFINER`, `SET search_path = ''`, `(select auth.uid())` evaluated once, tenant status and membership status checked.
4. `anon` has no table privileges. `authenticated` has `SELECT` where the matrix says so and write privileges only on master-data tables.
5. Ledger and financial tables have **no** INSERT/UPDATE/DELETE grants to application roles.
6. Views used by reports are `security_invoker = on`.
7. Policies must be covered by the negative suite below before merge.

### 6.1 Mandatory negative authorisation tests (TC-SEC)
| ID | Scenario | Expected |
|---|---|---|
| TC-SEC-01 | User of tenant A selects every tenant-owned table by tenant B's IDs | 0 rows on all tables |
| TC-SEC-02 | User of tenant A inserts/updates a row naming tenant B's `tenant_id` | Rejected |
| TC-SEC-03 | Child row references a parent in another tenant (composite FK) | Constraint violation |
| TC-SEC-04 | Branch-1 cashier reads branch-2 stock, invoices, sessions | 0 rows |
| TC-SEC-05 | Branch-1 cashier calls `pos_checkout` for branch 2 | `FORBIDDEN` |
| TC-SEC-06 | Revoked/disabled membership | Next request denied |
| TC-SEC-07 | Suspended tenant | All reads and writes denied |
| TC-SEC-08 | Cashier calls manager-only RPCs (void, adjust approve, price change, cost read) | `FORBIDDEN` |
| TC-SEC-09 | Cashier reads cost tables | 0 rows |
| TC-SEC-10 | Any role issues UPDATE/DELETE on invoices, payments, movements, audit logs | Permission denied |
| TC-SEC-11 | `anon` role reads any table or executes any RPC | Denied |
| TC-SEC-12 | Platform admin reads tenant business tables without a grant | 0 rows |
| TC-SEC-13 | Platform admin with an expired or revoked grant | 0 rows |
| TC-SEC-14 | Support grant used for a write | Denied |
| TC-SEC-15 | Owner of tenant A promotes themselves to platform admin | Denied |
| TC-SEC-16 | Storage: tenant A fetches a tenant B object path | Denied |
| TC-SEC-17 | RPC called with forged `tenant_id` / `branch_id` parameters | Ignored or denied; scope derived from membership |
| TC-SEC-18 | Reused/expired/foreign approval token | Rejected |
| TC-SEC-19 | Report views return only rows the caller could `SELECT` directly | Equal |
| TC-SEC-20 | Every `public` table has RLS enabled | CI check passes |

Application-level equivalents that run **today** without a database: strict-schema rejection of extra fields, forbidden when `sale.create` is missing, tampered role cookie falls back to the least-privileged role, discount refused for non-authorised roles (`actions.test.ts`, `engine.discount.test.ts`).

## 7. Authentication and session security
- Supabase Auth, email + password (≥ 10 chars, breached-password check if available), email verification, reset by emailed link.
- TOTP MFA mandatory for owners and platform admins (aal2 enforced in sensitive RPCs).
- Sessions in `HttpOnly`, `Secure`, `SameSite=Lax` cookies. Short-lived JWTs with refresh rotation. Server uses verified claims.
- Brute-force controls: provider limits plus a per-account-and-IP counter; generic error messages; reset requests never reveal whether an account exists.
- POS idle lock (default 10 min) with password re-entry.
- Permissions are read from membership tables on each request, never cached in the JWT, so revocation is immediate.
- **Counter approvals** never share the cashier's session: the manager's credentials are verified separately and produce a single-use, request-bound token that expires in 2 minutes.

## 8. Application-layer controls (implemented now vs specified)
| Control | Status |
|---|---|
| Strict Zod schemas that **reject** unknown fields (client price/total injection) | **Implemented**, tested |
| Server-side `sale.create` check in every billing action | **Implemented**, tested |
| Discount authority derived from the server-side role; default deny | **Implemented**, tested |
| Fail-closed billing backend (no fallback to fake data) | **Implemented**, tested |
| Demo role switch disabled in production builds | **Implemented**, tested |
| Exact-match barcode lookup | **Implemented**, tested |
| Idempotent checkout; positive-total rule; payment reconciliation | **Implemented in the demo engine**, tested |
| Security headers (nosniff, frame deny, referrer policy, permissions policy) | Configured in `next.config.ts`; **not yet verified against a running server**. CSP with nonces: Spec |
| Rate limiting | Spec |
| Authentication, MFA, tenant isolation, RLS, audit log | **Not built** |

## 9. Secret management
| Secret | Where it may exist | Never |
|---|---|---|
| `SUPABASE_SECRET_KEY` / service role, DB password | Vercel encrypted env (Production scope), GitHub Actions secrets, a password manager for operators | Browser code, `NEXT_PUBLIC_*`, the repository, logs, chat |
| Publishable (anon) key and project URL | Public env (designed to be public; safe only because of RLS) | — |
| Sentry auth token, SMTP credentials | CI / Vercel secrets | Repository |
| Backup encryption key | Password manager, split custody (owner + Nexvelt) | Next to the backups |

Controls: `src/env.ts` validates variables and fails the build if a server secret has a public prefix; the admin Supabase client lives in one `server-only` module that may be imported only from platform-admin and invite flows (ESLint restriction); secret scanning in CI; rotate keys on staff change, suspected exposure and at least yearly; separate keys per environment; preview deployments never receive production secrets.

## 10. Audit requirements
Audit entries are **append-only** (no UPDATE/DELETE for any role, enforced by trigger even for service credentials) and contain actor, time, branch, entity, before/after values, reason and request ID.

Mandatory events: sign-in/out and MFA events; membership and role changes; support grants and every access under them; changes to prices, costs, tax, rules, rates and settings; checkout, void, return, exchange, refund, payment correction; discounts given (amount, reason, approver); stock adjustments and approvals; goods receipt post/cancel; cash session open/close/variance sign-off; reprints; exports; failed authorisation attempts on privileged actions.

Retention per OQ-33 (until decided: life of the subscription). Owners can view their own audit log; it contains no secrets or card data.

## 11. Rate limiting and abuse prevention
| Surface | Limit (initial) | Response |
|---|---|---|
| Sign-in | 5 failures / 15 min per account and per IP | `RATE_LIMITED`, then temporary lock |
| Password reset | 3 / hour per email and per IP | Same generic success message |
| Checkout | 30 / min per user | `RATE_LIMITED` (idempotency keeps retries safe) |
| Barcode resolve / search | 120 / min per user | `RATE_LIMITED` |
| Exports | 5 / hour per user | `RATE_LIMITED` |
| Invitations | 20 / day per tenant | `RATE_LIMITED` |

Implemented in PostgreSQL (D-07) so limits hold across serverless instances. Additionally: request-size caps (carts ≤ 200 lines, payments ≤ 6, strings bounded), CSV formula-injection escaping, no open redirects, no user-controlled URLs fetched by the server.

## 12. Data protection and privacy
- Collect only name, phone and optional GSTIN/address, and only when needed (OQ-24). Walk-in sales need no customer.
- Card data: never store card numbers; only the last four digits if the client wants them (OQ-22). UPI references are not card data but are treated as sensitive in logs.
- PAN: store only what is legally required and only as agreed (OQ-23); prefer last four digits.
- Mask customer phone numbers for roles without `customer.view`.
- No personal data in logs, error reports or analytics (Sentry PII scrubbing).
- Support for access, correction and anonymisation requests under India's DPDP Act 2023; anonymisation keeps invoice snapshots required by law.

## 13. Backup, restoration and incident response
**Backups:** Supabase daily backups; PITR if approved (D-08); provider-independent daily logical dump encrypted off-platform (30 days daily + 12 months monthly). **Restore drills:** before go-live and quarterly, restoring into a scratch project and running integrity queries (ledger invariant, invoice sequence continuity, payment = invoice totals). Targets: RPO 24 h (5 min with PITR), RTO 4 h.

**Incident response** (full steps in the Runbook):
| Phase | Actions |
|---|---|
| Detect | Alerts (error spikes, auth anomalies), user reports, provider notices |
| Triage | Assign severity S1–S4; name an incident lead; open a timeline |
| Contain | Suspend a tenant or user, disable a feature flag, rotate keys, block an IP |
| Eradicate / recover | Fix forward, restore from backup only with approval, re-run integrity checks |
| Notify | Affected tenants without undue delay; regulators/data subjects as required by law (confirm the legal requirement with counsel) |
| Review | Blameless post-mortem within 5 working days; add a regression test; update this model |

## 14. Residual risks (current)
1. No authentication or isolation exists yet; the demo identity is a cookie. **The demo must never be exposed on a network.**
2. In-memory demo state is per process and not durable. It is not concurrency-safe across processes and must never hold real sales.
3. RLS and database concurrency properties are designed but **unverified** (no database has been available).
4. Hardware and print behaviour are unverified.
5. Tax and jewellery pricing rules are not configured (awaiting the client).
