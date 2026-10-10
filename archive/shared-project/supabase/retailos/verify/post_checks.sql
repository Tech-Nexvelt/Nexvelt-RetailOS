-- READ-ONLY post-migration checks. Every query below must return ZERO ROWS. Any row is a PROBLEM: stop and report it.
-- These exact queries are executed by tests/db/isolation.test.ts against the local fixture.

-- @query fn_callable_by_anon_or_public
select p.oid::regprocedure::text as problem
from pg_proc p
where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));

-- @query new_table_without_rls
select c.relname::text as problem
from pg_class c
where c.relnamespace = 'retailos'::regnamespace and c.relkind in ('r','p') and left(c.relname, 9) <> 'retailos_' and not c.relrowsecurity;

-- @query new_table_granted_to_anon
select c.relname::text as problem
from pg_class c cross join lateral aclexplode(c.relacl) a
where c.relnamespace = 'retailos'::regnamespace and c.relkind in ('r','p') and left(c.relname, 9) <> 'retailos_'
  and a.grantee = (select oid from pg_roles where rolname = 'anon');

-- @query ledger_table_with_write_grant_to_authenticated
select c.relname::text as problem
from pg_class c cross join lateral aclexplode(c.relacl) a
where c.relnamespace = 'retailos'::regnamespace
  and c.relname in ('audit_logs','inventory_movements','invoices','invoice_items','payments','idempotency_keys','document_sequences','metal_rates')
  and a.grantee = (select oid from pg_roles where rolname = 'authenticated') and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

-- @query unexpected_trigger_on_auth_users
select tgname::text as problem from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname <> 'trg_on_auth_user_created';

-- @query retailos_object_created_in_public
select c.relname::text as problem from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relname = any (array['tenants','branches','counters','roles','permissions','role_permissions','tenant_memberships','branch_memberships','tenant_settings','product_variants','inventory_balances','inventory_movements','idempotency_keys','document_sequences','cash_sessions','platform_admins','permission_overrides','role_discount_limits','audit_logs','tax_classes','tax_rates','brands','jewellery_items','jewellery_designs','metal_rates','barcode_aliases','tenant_sequences']);

-- @query live_table_missing
select t.n::text as problem from unnest(array['retailos_tenants','retailos_branches','retailos_memberships','retailos_products','retailos_product_variants','retailos_inventory','retailos_inventory_ledger','retailos_sales','retailos_sale_items','retailos_payments']) as t(n)
where to_regclass('retailos.' || t.n) is null;
