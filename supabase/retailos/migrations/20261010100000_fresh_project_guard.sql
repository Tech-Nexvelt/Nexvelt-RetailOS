-- RETAILOS migration for a DEDICATED Supabase project: fresh-project guard. HAND-WRITTEN (not generated).
-- Sealed in SHA256SUMS and pinned in ../MANIFEST.sha256.
--
-- Purpose: refuse to continue unless the target is demonstrably a fresh Supabase project that holds no other
-- application. This is the protection against pointing the migration at the wrong project (for example the
-- previous, shared one): that project has a `retailos` schema, application tables in `public` and a trigger on
-- `auth.users`, so this migration stops it before anything is created.
--
-- It only READS the catalog; it changes nothing. It tells apart:
--   * EXPECTED platform objects: Supabase's own schemas (auth, storage, realtime, extensions, graphql, vault, ...),
--     objects owned by extensions, and the roles/functions Supabase always provides. These are allowed.
--   * APPLICATION-owned objects: tables, views, sequences, functions, types and triggers that someone created
--     outside the platform. Any of these means the target is not fresh, and the guard aborts.
-- All problems found are reported together. Nothing is guessed: if a check cannot be satisfied, it aborts.
-- This is a safety check, not a feature: do not edit it to make a failing run pass; stop and investigate.

do $guard$
declare
  platform_schemas constant text[] := array[
    'information_schema', 'auth', 'storage', 'realtime', 'extensions', 'graphql', 'graphql_public',
    'pgbouncer', 'vault', 'supabase_functions', 'supabase_migrations', '_realtime', 'net', 'cron',
    'pgsodium', 'pgsodium_masks', '_analytics', '_supavisor', 'pgmq', 'topology', 'tiger', 'tiger_data'
  ];
  problems text[] := '{}';
  r record;
begin
  -- 1. This must be a Supabase project and the migration must run as the project owner.
  if current_user <> 'postgres' then
    problems := problems || format('connected as role "%s"; run the migration as the project owner "postgres"', current_user);
  end if;
  for r in select x.role_name from unnest(array['anon', 'authenticated', 'service_role']) as x(role_name)
           where not exists (select 1 from pg_roles where rolname = x.role_name) loop
    problems := problems || format('required Supabase role "%s" does not exist: this does not look like a Supabase project', r.role_name);
  end loop;
  if to_regclass('auth.users') is null then
    problems := problems || 'table auth.users does not exist: Supabase Auth is not set up on this database'::text;
  end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then
    problems := problems || 'functions auth.uid() / auth.jwt() do not exist: Supabase Auth is not set up on this database'::text;
  end if;

  -- 2. The schemas this migration creates must not exist yet.
  for r in select nspname from pg_namespace where nspname in ('retailos', 'retailos_private') order by 1 loop
    problems := problems || format('schema "%s" already exists: this target is not fresh (or RetailOS was already installed)', r.nspname);
  end loop;

  -- 3. No application-owned relations (tables, views, materialized views, foreign tables, sequences) anywhere
  --    outside the platform schemas, including schema public. Extension-owned objects are expected and ignored.
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and n.nspname <> all (platform_schemas)
      and n.nspname !~ '^pg_'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i') and c.relkind = 'S')
    order by 1, 2
    limit 20
  loop
    problems := problems || format('application object already exists: %s.%s (kind %s): this target holds another application', r.nspname, r.relname, r.relkind);
  end loop;

  -- 4. No application-owned functions or types outside the platform schemas.
  for r in
    select n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname <> all (platform_schemas)
      and n.nspname !~ '^pg_'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by 1, 2
    limit 20
  loop
    problems := problems || format('application function already exists: %s.%s(): this target holds another application', r.nspname, r.proname);
  end loop;
  for r in
    select n.nspname, t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typtype in ('e', 'd', 'r')
      and n.nspname <> all (platform_schemas)
      and n.nspname !~ '^pg_'
      and not exists (select 1 from pg_depend d where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')
    order by 1, 2
    limit 20
  loop
    problems := problems || format('application type already exists: %s.%s: this target holds another application', r.nspname, r.typname);
  end loop;

  -- 4b. No application-owned triggers or policies on tables we do not own is covered by (3); explicit check for
  --     triggers on Supabase Auth's user table, which is where another application would hook sign-up.
  if to_regclass('auth.users') is not null then
    for r in select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal order by 1 loop
      problems := problems || format('trigger "%s" exists on auth.users: another application hooks sign-up on this project', r.tgname);
    end loop;
  end if;

  if array_length(problems, 1) is not null then
    raise exception E'RetailOS migration REFUSED: the target is not a fresh, dedicated Supabase project.\n  - %\nNothing was changed. Create a new, empty Supabase project for RetailOS and run the migration there. Do not edit this check.',
      array_to_string(problems, E'\n  - ')
      using errcode = 'P0001';
  end if;
end;
$guard$;
