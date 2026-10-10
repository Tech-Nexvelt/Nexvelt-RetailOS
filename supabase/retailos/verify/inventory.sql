-- READ-ONLY. A canonical, order-stable description of everything RetailOS owns in the database: one line per
-- object, "kind|name|detail". Run it after the migration and compare with expected_inventory.txt:
--     psql -At -f supabase/retailos/verify/inventory.sql > inventory-actual.txt
--     node scripts/verify-schema.mjs inventory-actual.txt
-- The comparison reports exactly which lines are MISSING or UNEXPECTED, so a mismatch is explained, not just detected.
-- Details use md5 of expressions so lines stay short; ownership and API-role privileges are spelled out.
-- Nothing here reads business data and nothing here writes.
with
tbl as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
  from pg_class c where c.relnamespace = 'retailos'::regnamespace and c.relkind in ('r', 'p')
),
lines as (
  select 'schema|' || n.nspname || '|owner=' || pg_get_userbyid(n.nspowner) as l
    from pg_namespace n where n.nspname in ('retailos', 'retailos_private')
  union all
  select 'schema_usage|' || n.nspname || '|' || r.rolname || '=' || has_schema_privilege(r.rolname, n.oid, 'usage')::text
    from pg_namespace n cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname in ('retailos', 'retailos_private')
  union all
  select 'table|retailos.' || relname || '|rls=' || relrowsecurity::text || ' force=' || relforcerowsecurity::text || ' owner=' || owner from tbl
  union all
  select 'column|retailos.' || t.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull::text || ' default=' || coalesce(md5(pg_get_expr(d.adbin, d.adrelid)), '-')
         || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
    from tbl t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'constraint|retailos.' || t.relname || '.' || k.conname || '|' || k.contype::text || ' ' || md5(pg_get_constraintdef(k.oid))
    from tbl t join pg_constraint k on k.conrelid = t.oid
  union all
  select 'index|retailos.' || t.relname || '.' || ic.relname || '|' || md5(pg_get_indexdef(i.indexrelid))
    from tbl t join pg_index i on i.indrelid = t.oid join pg_class ic on ic.oid = i.indexrelid
  union all
  select 'trigger|retailos.' || t.relname || '.' || g.tgname || '|enabled=' || g.tgenabled::text || ' ' || md5(pg_get_triggerdef(g.oid))
    from tbl t join pg_trigger g on g.tgrelid = t.oid where not g.tgisinternal
  union all
  select 'policy|retailos.' || p.tablename || '.' || p.policyname || '|' || p.cmd || ' ' || p.permissive || ' roles=' || array_to_string(p.roles, ',')
         || ' using=' || coalesce(md5(p.qual), '-') || ' check=' || coalesce(md5(p.with_check), '-')
    from pg_policies p where p.schemaname = 'retailos'
  union all
  -- API-role privileges per table, spelled out so a wrong grant is visible by name
  select 'table_privs|retailos.' || t.relname || '|' || r.rolname || '=' ||
         coalesce((select string_agg(pr.p, ',' order by pr.p) from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as pr(p)
                   where has_table_privilege(r.rolname, t.oid, pr.p)), '-')
    from tbl t cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
  union all
  select 'function|' || p.oid::regprocedure::text || '|secdef=' || p.prosecdef::text || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '-')
         || ' owner=' || pg_get_userbyid(p.proowner) || ' execute: public=' || has_function_privilege('public', p.oid, 'execute')::text
         || ' anon=' || has_function_privilege('anon', p.oid, 'execute')::text
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
         || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
    from pg_proc p where p.pronamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
  union all
  select 'default_acl|' || d.defaclnamespace::regnamespace::text || '|' || d.defaclobjtype::text || ' ' || coalesce(d.defaclacl::text, '-')
    from pg_default_acl d where d.defaclnamespace in ('retailos'::regnamespace, 'retailos_private'::regnamespace)
  union all
  select 'marker|schema_info|app=' || app || ' version=' || schema_version::text || ' set=' || migration_set from retailos.schema_info
  union all
  select 'auth_users_triggers|auth.users|' || count(*)::text from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal
)
select l from lines order by l;
