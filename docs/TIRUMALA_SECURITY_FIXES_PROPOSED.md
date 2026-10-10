# Tirumala Furniture security findings — PROPOSALS ONLY, NOTHING APPLIED

Found by read-only audits of the shared Supabase project on 2026-10-10 and confirmed on a catalog-faithful local clone. They belong to Tirumala's own app, so each needs the Tirumala owner's decision, a test in Tirumala's real flows, and (for SQL) a capture of the current definitions first. **Nothing here has been run, and RetailOS does not depend on any of it.** The RetailOS migration is designed to be safe whether or not these are applied.

Facts used: `public.profiles.role` has the check `role IN ('admin','cashier')`; there is 1 user and 2 stores; sign-ups are **enabled**; Postgres 17.6.

## Findings

| # | What | Evidence |
|---|---|---|
| F1 | A sign-up chooses its own Tirumala role (default `admin`) | `handle_new_user()` copies `raw_user_meta_data->>'role'`, default `'admin'`; `is_admin()` is `profiles.role = 'admin'` |
| F2 | Anyone, even signed out, can insert into `stores` | policy `stores_insert`: roles `anon, authenticated, service_role`, `WITH CHECK (true)` |
| F3 | Any signed-in user can read and update every store's `mobile_scans`; anyone can insert | policies "Store users can read/update their scans": `auth.uid() IS NOT NULL`; "Anyone can insert mobile scans": `true` |
| F4 | `is_admin()`, `get_my_store_id()` are `SECURITY DEFINER` with no fixed `search_path` | function definitions |
| F5 | A sign-up with any other metadata role (e.g. `tenant_owner`) makes the whole sign-up **fail** | profiles check constraint vs the trigger (reproduced on the clone) |

---

## Part 1 — The sign-up setting (a dashboard switch, no SQL)

**Change:** Authentication → Sign In / Providers → turn off "Allow new users to sign up".

| | |
|---|---|
| Helps with | stops strangers creating accounts through the public sign-up endpoint, which removes F1 and the signed-in leg of F3 for strangers |
| Does **not** fix | **F2** (anonymous inserts into `stores` need no account); **F3 for existing users** (a RetailOS cashier is an existing user and can still read Tirumala's `mobile_scans`); **F1 for admin-created users** (invites and users you add still get the default role `admin`) |
| Impact on RetailOS | none expected: staff invites use the server's admin key, which is not a public sign-up. **UNVERIFIED** until tested on the hosted project (sends a real invite) |
| Impact on Tirumala | breaks any Tirumala screen that lets people register themselves. Unknown to me; **ask the Tirumala owner** whether such a screen exists |
| Risk of applying | low-medium: a Tirumala registration or onboarding flow stops working; reversible in one click |
| Risk of leaving it | strangers can create accounts and receive a Tirumala profile with a self-chosen `admin`/`cashier` role |
| Test | try to sign up on Tirumala's app after the change (expect refusal) and invite a user from RetailOS Settings (expect success) |
| Rollback | switch it back on |
| Decision owner | Tirumala owner (and you) |

This setting is independent of every SQL fix below. Applying it does not make them unnecessary; applying a SQL fix does not make it unnecessary.

---

## Part 2 — Tirumala SQL fixes (each independent; apply in a clone first)

**Before applying ANY of them,** capture the current definitions so rollback is exact (read-only):
```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in ('stores', 'mobile_scans') order by 2, 3;
select pg_get_functiondef('public.handle_new_user()'::regprocedure);
select p.proname, p.proconfig from pg_proc p where p.proname in ('is_admin', 'get_my_store_id') and p.pronamespace = 'public'::regnamespace;
```
Save the output next to the backup. **A database backup must exist and be verified first** (none exists today).

### T1 — never trust a client-supplied role (fixes F1, F5, and the Tirumala-profile side effect of RetailOS invites)
```sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'cashier')  -- least privilege, never from metadata
  on conflict (id) do nothing;
  return new;
end $$;
```
| | |
|---|---|
| Impact on Tirumala | every new user becomes `cashier`. **If Tirumala creates admins by passing `role: admin` in sign-up metadata, that stops working** and admins must be set by a server action or SQL. The existing admin is unaffected (`ON CONFLICT DO NOTHING`) |
| Impact on RetailOS | RetailOS invitees get a Tirumala `cashier` profile with no store instead of `admin`: strictly safer. Their RetailOS permissions come only from RetailOS memberships and are unchanged |
| Risk of applying | medium: breaks an admin-by-metadata flow if one exists (unknown). Hits only users created after the change |
| Risk of leaving | a self-signup (while sign-ups are on) or any admin-created user becomes a Tirumala `admin`-role profile; today limited because they have no `store_id` and policies also require a store match, but this depends on every policy keeping that pairing |
| Test | create a user with metadata `{role:'admin'}` on a clone: expect role `cashier`; create one with `{role:'tenant_owner'}`: expect success (no failure) |
| Rollback | restore the captured function body (original: role from metadata, default `'admin'`) |

### T2 — close open store creation (F2)
```sql
drop policy stores_insert on public.stores;
create policy stores_insert on public.stores for insert to service_role with check (true);
```
| | |
|---|---|
| Impact on Tirumala | `stores` can then only be created with the service key. **There is a trigger `after_store_insert` and a seed trigger `after_store_seed`, which suggests Tirumala creates a store during onboarding/sign-up, possibly from the browser as an anonymous or just-created user. If so, this fix breaks onboarding.** Unknown to me |
| Impact on RetailOS | none |
| Risk of applying | **high until Tirumala confirms how stores are created** |
| Risk of leaving | anyone with the public anon key can insert unlimited `stores` rows (spam, and each triggers seed logic) |
| Test | on a clone, run Tirumala's onboarding path as an anonymous user and as a new signed-in user |
| Rollback | `drop policy stores_insert on public.stores; create policy stores_insert on public.stores for insert to anon, authenticated, service_role with check (true);` (original, from the audit) |

### T3 — scope `mobile_scans` to the user's own store (F3)
```sql
drop policy "Store users can read their scans"   on public.mobile_scans;
drop policy "Store users can update their scans" on public.mobile_scans;
create policy mobile_scans_select on public.mobile_scans for select to authenticated using (store_id = public.get_my_store_id());
create policy mobile_scans_update on public.mobile_scans for update to authenticated
  using (store_id = public.get_my_store_id()) with check (store_id = public.get_my_store_id());
```
Optionally tighten the open insert policy to stores with an unexpired pairing session (needs the phone-scanner flow understood first):
```sql
drop policy "Anyone can insert mobile scans" on public.mobile_scans;
create policy mobile_scans_insert on public.mobile_scans for insert to anon, authenticated
  with check (exists (select 1 from public.scanner_pairing_sessions s where s.store_id = mobile_scans.store_id and s.expires_at > now()));
```
| | |
|---|---|
| Impact on Tirumala | the select/update part is low risk (users only lose access to other stores' scans). The insert part is **higher risk**: the phone scanner may insert as `anon` without any pairing row of the form assumed here |
| Impact on RetailOS | removes the cross-app leak: a RetailOS cashier can currently read Tirumala's scans (proved by the "KNOWN TIRUMALA ISSUE" test) |
| Risk of leaving | a RetailOS user can read and modify Tirumala barcodes scanned by phones; anyone can inject scans |
| Test | real phone-pairing and scan on a clone; after applying, invert the "KNOWN TIRUMALA ISSUE" test in `tests/db/isolation.test.ts` |
| Rollback | recreate the three original policies exactly as captured (originals: roles `public`, select/update `USING (auth.uid() IS NOT NULL)`, insert `WITH CHECK (true)`) |

### T4 — pin the search path (F4)
```sql
alter function public.is_admin()        set search_path = public;
alter function public.get_my_store_id() set search_path = public;
```
| | |
|---|---|
| Impact | none expected; these functions read only `profiles` |
| Risk of applying | very low |
| Risk of leaving | low (a `SECURITY DEFINER` function without a fixed search path can be hijacked by an object in a schema earlier in the path) |
| Test | sign in as the admin and load the app |
| Rollback | `alter function public.is_admin() reset search_path; alter function public.get_my_store_id() reset search_path;` |

---

## Suggested decision order (cheapest and safest first)
1. **T4** — trivial and safe.
2. **Part 1 (sign-ups)** — after the Tirumala owner confirms no self-registration screen.
3. **T3 select/update part** — then, separately, the insert part after the scanner flow is understood.
4. **T1** — after confirming no admin-by-metadata flow.
5. **T2** — last; needs the onboarding flow explained.

Each step: backup verified → capture → apply on a clone/branch → test Tirumala's flows → apply to production → re-run the Tirumala smoke test. About 1–2 hours of testing in total; I would only prepare and test these on a clone. None is required for **RetailOS's own** isolation (a Tirumala-only user cannot reach RetailOS, tested). But the exposure runs the other way too: **until T3 (or an equivalent) is applied, every RetailOS login, including each invited cashier, can read and modify Tirumala's `mobile_scans`**, and T1/T5 give each of them a Tirumala profile. If T3 is not approved before go-live, the safest alternative is to limit RetailOS logins to the owner until it is.
