-- READ-ONLY snapshot queries. Run BEFORE and AFTER the migration (as the same role) and compare the hash column.
-- Each query returns one row {h}. Expected result:
--   tirumala, live, auth_triggers : IDENTICAL before and after.
--   retailos_schema               : DIFFERENT after (schema USAGE for service_role and the default privileges change on purpose);
--                                   IDENTICAL again after rollback.sql.
-- These exact queries are executed by tests/db/isolation.test.ts. Nothing here writes anything.

-- @query tirumala
select md5(coalesce(string_agg(x, '|' order by x), '')) as h from (
    select 'rel:' || c.relname::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text as x
      from pg_class c where c.relnamespace = 'public'::regnamespace
    union all select 'col:' || a.attrelid::regclass || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || a.attnotnull::text::text
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    union all select 'con:' || conrelid::regclass || conname || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
    union all select 'pol:' || tablename || '.' || policyname || coalesce(roles::text, '') || cmd::text || coalesce(qual, '') || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all select 'fn:' || p.oid::regprocedure || coalesce(p.proacl::text, '') || md5(p.prosrc) || coalesce(p.proconfig::text, '')
      from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all select 'trg:' || tgrelid::regclass::text || tgname || tgenabled::text || pg_get_triggerdef(oid)
      from pg_trigger where not tgisinternal and (tgrelid = 'auth.users'::regclass or tgrelid::regclass::text like 'public.%')
    union all select 'dacl:' || pg_get_userbyid(defaclrole) || defaclobjtype::text::text || coalesce(defaclacl::text, '')
      from pg_default_acl where defaclnamespace = 'public'::regnamespace
    union all select 'nsp:' || coalesce(nspacl::text, '') from pg_namespace where nspname = 'public'
  ) s;

-- @query live
select md5(coalesce(string_agg(x, '|' order by x), '')) as h from (
    select 'rel:' || c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text || c.relforcerowsecurity::text as x
      from pg_class c where c.relnamespace = 'retailos'::regnamespace and left(c.relname, 9) = 'retailos_'
    union all select 'col:' || a.attrelid::regclass || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || a.attnotnull
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'retailos'::regnamespace and left(c.relname, 9) = 'retailos_' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    union all select 'con:' || conrelid::regclass || conname || pg_get_constraintdef(oid) from pg_constraint
      where connamespace = 'retailos'::regnamespace and left(conrelid::regclass::text, 18) = 'retailos.retailos_'
    union all select 'pol:' || tablename || '.' || policyname || coalesce(roles::text, '') || cmd::text || coalesce(qual, '') || coalesce(with_check, '')
      from pg_policies where schemaname = 'retailos' and left(tablename, 9) = 'retailos_'
  ) s;

-- @query auth_triggers
select coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), '|' order by tgname), '') as h
  from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- @query retailos_schema
select md5(coalesce((select nspacl::text from pg_namespace where nspname = 'retailos'), '') || '|' || coalesce((select string_agg(pg_get_userbyid(defaclrole) || defaclobjtype::text || coalesce(defaclacl::text, ''), '|' order by defaclobjtype::text) from pg_default_acl where defaclnamespace = 'retailos'::regnamespace), '')) as h;

