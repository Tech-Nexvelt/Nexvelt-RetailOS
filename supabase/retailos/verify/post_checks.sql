-- READ-ONLY post-migration checks for the dedicated RetailOS project.
-- EVERY query below must return ZERO ROWS. Any row is a PROBLEM: stop and report it.
-- These exact queries are executed by tests/db/dedicated-project.test.ts against a freshly migrated database.

-- @query function_callable_by_anon_or_public
select p.oid::regprocedure::text as problem
from pg_proc p
where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'));

-- @query security_definer_function_without_fixed_search_path
select p.oid::regprocedure::text as problem
from pg_proc p
where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
  and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');

-- @query table_without_row_level_security
select c.relname::text as problem
from pg_class c
where c.relnamespace = 'retailos'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- @query table_privilege_held_by_anon
select c.relname::text as problem
from pg_class c cross join lateral aclexplode(c.relacl) a
where c.relnamespace = 'retailos'::regnamespace and c.relkind in ('r', 'p')
  and a.grantee = (select oid from pg_roles where rolname = 'anon');

-- @query ledger_table_with_write_privilege_for_api_roles
select c.relname::text || ' (' || r.rolname || ')' as problem
from pg_class c
cross join (values ('authenticated'), ('service_role')) as r(rolname)
where c.relnamespace = 'retailos'::regnamespace
  and c.relname in ('audit_logs', 'inventory_movements', 'invoices', 'invoice_items', 'payments', 'idempotency_keys', 'document_sequences', 'metal_rates', 'schema_info')
  and (has_table_privilege(r.rolname, c.oid, 'INSERT') or has_table_privilege(r.rolname, c.oid, 'UPDATE')
       or has_table_privilege(r.rolname, c.oid, 'DELETE') or has_table_privilege(r.rolname, c.oid, 'TRUNCATE'));

-- @query schema_usable_by_anon
select n.nspname::text || ' (anon usage)' as problem
from pg_namespace n
where n.nspname in ('retailos', 'retailos_private') and has_schema_privilege('anon', n.oid, 'usage');

-- @query policy_open_to_public_or_anon
select p.tablename::text || '.' || p.policyname as problem
from pg_policies p
where p.schemaname = 'retailos' and (p.roles && array['public', 'anon']::name[]);

-- @query tautological_policy
select p.tablename::text || '.' || p.policyname as problem
from pg_policies p
where p.schemaname = 'retailos'
  and (regexp_replace(coalesce(p.qual, ''), '[()\s]', '', 'g') = 'true' or regexp_replace(coalesce(p.with_check, ''), '[()\s]', '', 'g') = 'true');

-- @query trigger_on_auth_users
select tgname::text as problem from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- @query application_object_in_public_schema
select c.relname::text as problem
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');

-- @query schema_marker_missing_or_wrong
select 'schema_info' as problem
where not exists (select 1 from retailos.schema_info where app = 'retailos' and schema_version = 1 and migration_set = 'dedicated-project-v1');
