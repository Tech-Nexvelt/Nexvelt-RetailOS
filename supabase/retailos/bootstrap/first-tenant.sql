-- RETAILOS-SCHEMA PORT of supabase/bootstrap/first-tenant.sql (generated). Run ONLY after the retailos migrations are applied and approved.
-- ONE-TIME SETUP for NR Collections. Run this once, in the Supabase SQL editor, after:
--   1. the migrations in supabase/retailos/migrations (NOT supabase/migrations) have been applied, and
--   2. the owner has been created under Authentication > Users (email + password, "Auto confirm" on).
--
-- What it does: creates the business, its single branch and counter, and makes that existing login
-- the OWNER. It is safe to run twice (it skips what already exists). It changes nothing else.
--
-- What it does NOT do (on purpose): it sets no tax rate, no GSTIN and no address. The owner enters
-- those in Settings once NR Collections has confirmed them.
--
-- EDIT THE FIVE VALUES BELOW, then run. Leaving a REPLACE_ value in place makes the script stop.

do $$
declare
  v_owner_email  constant text := 'REPLACE_WITH_OWNER_EMAIL';                 -- the login created in Authentication
  v_trade_name   constant text := 'NR Collections';
  v_legal_name   constant text := 'NR Collections';                          -- registered name, if different
  v_state_code   constant text := 'REPLACE_WITH_2_CHARACTER_STATE_CODE';     -- exactly 2 characters; NR Collections must confirm this
  v_tenant_code  constant text := 'NRC';                                     -- 2-10 capital letters/digits, used in barcodes

  v_owner uuid;
  v_tenant uuid;
  v_branch uuid;
  v_role uuid;
begin
  if v_owner_email like 'REPLACE%' or v_state_code like 'REPLACE%' then
    raise exception 'Edit the values at the top of this script before running it.';
  end if;
  if length(v_state_code) <> 2 then
    raise exception 'State code must be exactly 2 characters.';
  end if;

  select id into v_owner from auth.users where lower(email) = lower(v_owner_email);
  if v_owner is null then
    raise exception 'No login found for %. Create the owner under Authentication > Users first.', v_owner_email;
  end if;
  -- the profile row is created by a trigger when the login is created; make sure it exists
  insert into retailos.profiles (id, full_name) values (v_owner, '') on conflict (id) do nothing;

  select id into v_tenant from retailos.tenants where code = v_tenant_code;
  if v_tenant is null then
    insert into retailos.tenants (code, legal_name, trade_name) values (v_tenant_code, v_legal_name, v_trade_name) returning id into v_tenant;
    insert into retailos.tenant_settings (tenant_id) values (v_tenant);
  end if;

  select id into v_branch from retailos.branches where tenant_id = v_tenant and code = 'MAIN';
  if v_branch is null then
    insert into retailos.branches (tenant_id, code, name, state_code) values (v_tenant, 'MAIN', 'Main branch', v_state_code) returning id into v_branch;
    insert into retailos.counters (tenant_id, branch_id, code, name) values (v_tenant, v_branch, 'C1', 'Counter 1');
  end if;

  select id into v_role from retailos.roles where key = 'tenant_owner' and tenant_id is null;
  insert into retailos.tenant_memberships (tenant_id, user_id, role_id, status)
    values (v_tenant, v_owner, v_role, 'ACTIVE')
  on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, status = 'ACTIVE';

  raise notice 'Done. % is now the owner of % (branch MAIN, counter C1).', v_owner_email, v_trade_name;
end;
$$;
