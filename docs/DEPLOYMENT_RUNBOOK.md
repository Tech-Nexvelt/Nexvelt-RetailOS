# NexVelt RetailOS — Deployment Runbook

| Field | Value |
|---|---|
| Document ID | NXR-RUN |
| Version | 0.2 |
| Date | 2026-10-10 |
| Related | [TRD](TRD.md) §15–§20 · [Security Model](SECURITY_MODEL.md) §9, §13 |

**Verification legend.** `VERIFIED` = executed successfully in this repository on 2026-10-10. `UNTESTED` = written from the design and the tools' documented behaviour, **never run** because no Docker daemon, Supabase project or Vercel project is available yet. Treat every `UNTESTED` step as a draft to be rehearsed on staging before it is relied on. **Rule for operators: never run an UNTESTED step against production without rehearsing it on staging first and getting written approval.**

---

## 1. Prerequisites
| Item | Requirement |
|---|---|
| Node.js | ≥ 22.13 (`engines`); CI/production target 24 LTS (TRD §2). Local machine had 22.23.2. |
| npm | 10.x (the only package manager; do not use pnpm or yarn) |
| Git | any recent version |
| Docker Desktop | required only for the local Supabase stack (Phase 2+) |
| Supabase CLI | installed with `npm install -D supabase` when Phase 2 begins (not yet in `package.json`) |
| Accounts | Supabase (dev, staging, production projects), Vercel, GitHub, SMTP provider, error monitoring. Ownership per OQ-28. |

## 2. Fresh local setup (current state — demo mode) — VERIFIED
```bash
git clone <repository-url> nexvelt-retailos
cd nexvelt-retailos
npm ci
cp .env.example .env.local     # contains BILLING_BACKEND=demo (development only)
npm run dev                    # http://localhost:3000
```
Quality gate before any commit or deployment:
```bash
npm run lint && npm run typecheck && npm test && npm run build
```
Expected on 2026-10-10: lint 0 problems; typecheck 0 errors; 130 tests pass; build succeeds.

> **Demo mode warning.** `BILLING_BACKEND=demo` runs the in-memory fictitious backend with a fake role cookie and **no authentication**. Never expose a demo instance to a network or real staff. With the variable unset, billing refuses to run (fails closed).

## 3. Supabase configuration — UNTESTED
For each of **dev**, **staging**, **production** create a separate project (region `ap-south-1` Mumbai, D-02). Production: paid plan; decide on point-in-time recovery (D-08).

1. **Auth settings:** email + password; require email confirmation; minimum password length 10; enable leaked-password protection if the plan offers it; disable open sign-up (users are created only by invitation); set Site URL and Redirect URLs to the environment's domain only; configure **custom SMTP** (D-10); enable MFA (TOTP); JWT expiry 3600 s.
2. **API settings:** expose only the `public` schema; the `private`, `pricing` and `tax` schemas must **not** be exposed.
3. **Network:** restrict direct database access to CI and operator IPs where the plan allows.
4. **Storage:** create private buckets (`branding`, `product-images`, `imports`); policies come from migrations.
5. **Keys:** note the project URL and publishable key (public), and the secret/service key (**server-only**, store in a password manager and the hosting provider's secret store, never in the repository).
6. **Backups:** confirm daily backups are on; enable PITR in production if approved.

## 4. Environment variables — partly VERIFIED
| Variable | Scope | Environments | Purpose |
|---|---|---|---|
| `BILLING_BACKEND` | server | **dev only** (`demo`). **Unset** in staging/production | Enables the demo backend. Anything but `demo` = fail closed. VERIFIED |
| `NEXT_PUBLIC_SUPABASE_URL` | public | all | Supabase project URL (Phase 2) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | all | Public key; safe only because RLS is enforced (Phase 2) |
| `SUPABASE_SECRET_KEY` | **server only** | all | Admin operations (invites, tenant provisioning). Never `NEXT_PUBLIC_`. (Phase 2) |
| `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | server / CI | staging, production | Error monitoring (D-09, Phase 9) |
| `NEXT_PUBLIC_APP_ENV` | public | all | `development` / `staging` / `production` label |

Rules: `.env.local` is git-ignored; `.env.example` holds names and safe placeholders only; secrets exist only in Vercel encrypted variables (scoped per environment) and GitHub Actions secrets; preview deployments use the **staging** Supabase project and never receive production secrets.

## 5. Applying database migrations — UNTESTED (none exist yet)
Migrations are forward-only SQL files in `supabase/migrations/` (map in DATABASE_DESIGN §17).

**Local / dev:**
```bash
npx supabase start                 # requires Docker
npx supabase db reset              # local only: rebuilds from migrations + seed
npx supabase test db               # pgTAP tests, including the RLS negative suite
npx supabase gen types typescript --local > src/types/database.ts
```
**Staging:** `npx supabase link --project-ref <staging-ref>` then `npx supabase db push --dry-run`, review the SQL, then `npx supabase db push`.

**Production (requires written approval for each release):**
1. Take and verify a fresh backup (§8). Note the time.
2. `npx supabase db push --dry-run` against production; a second person reviews the output.
3. Confirm the migration is **backward compatible** with the currently deployed app (expand first, contract later).
4. Apply with `npx supabase db push` during a quiet period.
5. Run the smoke tests (§7). If anything fails, follow §9.

**Never** run `db reset`, `DROP`, `TRUNCATE`, type-narrowing or data-rewriting statements on staging/production without explicit written approval and a verified backup. Do not seed production with `seed.sql` (it is for local use only); reference data comes from migrations and tenants are created through the platform-admin screen.

## 6. Production deployment — UNTESTED
**First-time setup**
1. Create the Vercel project from the repository; Node 24; region `bom1`; production branch = `main`, production deployments gated by release tags.
2. Add environment variables (§4) in Vercel, scoped per environment. Do **not** set `BILLING_BACKEND` in staging/production.
3. Attach the domain; enable HTTPS only and HSTS.
4. Configure SMTP, monitoring and the uptime check on `/api/health` (every 1 min, from India).
5. Provision the production Supabase project (§3) and apply migrations (§5).
6. Create the platform-admin account, enable TOTP, then create the NR Collections tenant and invite the owner through the admin screen.

**Pre-release checklist (all must be true)**
- [ ] CI green on the release commit (lint, typecheck, tests, pgTAP, build, secret scan, dependency audit).
- [ ] Staging UAT scripts passed; no open S1/S2 defects.
- [ ] No demo identity, demo backend or fixture data in the production build or configuration.
- [ ] `BILLING_BACKEND` is unset in production, and the production backend is the database-backed one.
- [ ] Secrets only in server-side stores; a bundle search finds none.
- [ ] Backup taken; restore drill recorded within the last 90 days.
- [ ] Rollback owner and contact identified.

**Release steps:** merge to `main` → staging auto-deploys → smoke test → tag `vX.Y.Z` → approval → apply production migrations (§5) → promote the Vercel deployment → smoke test (§7) → announce.

## 7. Smoke test after every deployment
1. `/api/health` returns OK with the database reachable.
2. Sign in as a test cashier; land on Billing.
3. Scan one known barcode; a priced line appears.
4. Complete a ₹-small test sale **in staging only** (never create test invoices in production; use a read-only check there).
5. Sign in as the owner (MFA) and open Reports.
6. Check Sentry for new errors.

## 8. Backups and restore verification — UNTESTED
| Backup | Frequency | Retention |
|---|---|---|
| Supabase managed daily backup | daily | per plan |
| PITR (if approved) | continuous | per add-on |
| Encrypted logical dump to storage outside Supabase | daily | 30 days daily, 12 months monthly |
| Storage buckets | weekly | 30 days |

**Restore drill (before go-live, then quarterly):**
1. Create a scratch Supabase project (never restore over production for a drill).
2. Restore the most recent logical dump into it.
3. Run integrity checks: ledger invariant (balances = Σ movements), invoice-number continuity per branch and year, Σ payments = invoice totals, row counts vs. the source, no orphan rows.
4. Record the elapsed time against RTO 4 h and the data age against RPO.
5. Delete the scratch project and record the result in the drill log.

## 9. Rollback
| Situation | Action |
|---|---|
| Bad application release | Vercel → promote the previous deployment (instant). |
| Bad migration (no data damage) | Ship a **forward-fix migration**; roll the app back first if it depends on the new schema. |
| Data corruption | Stop writes (suspend the tenant or enable maintenance mode), restore from backup/PITR into a scratch project, compare, then **with written approval** restore or repair production. Record in the incident log. |
| Risky feature | Disable its feature flag for the tenant. |
| Suspected credential leak | Rotate the affected keys immediately (§11), review audit logs. |

Billing is online-only: during a rollback or outage, use the **paper-bill fallback** (§10).

## 10. Operations
**Paper fallback during an outage (A-20):** use numbered paper bill books kept at the counter; record item, price and payment; enter the sales into RetailOS after recovery as normal sales with a note, using the day's date, and have the manager reconcile in the day-close report. Tell the owner immediately.

**Daily:** owner/manager starts the day (opening cash), checks that metal rates are entered, closes the day with a counted cash figure.
**Weekly:** review audit events for voids, discounts, corrections and adjustments.
**Monthly:** review error rate, uptime, storage usage, user list (remove leavers), dependency alerts.
**Quarterly:** restore drill, key rotation review, platform-admin access review.

## 11. Secret rotation — UNTESTED
1. Create the new key in Supabase (or provider).
2. Update Vercel/GitHub secrets for the environment.
3. Redeploy; run the smoke test.
4. Revoke the old key; record who/when/why.
Rotate after any staff change with access, any suspected exposure, and at least yearly.

## 12. Incident handling
Severity S1–S4 per Test Strategy §8 and PRD §14.2. Steps: detect → assign an incident lead → contain (suspend tenant/user, disable feature, rotate keys) → recover (fix forward; restore only with approval) → notify affected customers without undue delay and consult counsel on any legal notification duty → blameless review within 5 working days with a regression test.

## 13. Operational handover checklist
- [ ] Owner and managers trained; user guide delivered (billing, returns, day close, label printing).
- [ ] Counter PC set up: Chrome/Edge, kiosk printing for the receipt printer, scanner in HID mode with an Enter suffix, label printer calibrated.
- [ ] Accounts: owner with MFA; individual logins for every staff member; platform-admin list reviewed.
- [ ] Hosting-account ownership and credentials transferred per OQ-28 (password manager, split custody).
- [ ] Backups verified; restore drill report delivered.
- [ ] Support terms, contacts, severity table and the included-hosting end date confirmed in writing (OQ-28/29).
- [ ] Known limitations delivered in writing (online-only billing, no payment-gateway integration, manual UPI/card confirmation, items awaiting client decisions).
- [ ] Open defects list with agreed dates.

## 14. Known gaps in this runbook
No migrations, Supabase project, Vercel project, CI pipeline or hardware setup exists yet. Sections 3, 5, 6, 8 and 11 must be rehearsed and corrected on staging, then re-labelled VERIFIED.
