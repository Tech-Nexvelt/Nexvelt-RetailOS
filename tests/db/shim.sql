-- TEST-ONLY SHIM. NOT a migration and never applied to Supabase.
--
-- Supabase pre-provisions these objects in every project. The tests run on plain PostgreSQL, so this
-- file recreates the parts the migrations depend on, matching Supabase's behaviour closely enough
-- to make the security tests meaningful:
--   * roles anon / authenticated / service_role (service_role bypasses RLS)
--   * the auth schema, auth.users, auth.uid(), auth.jwt(), auth.role()
--   * Supabase's DEFAULT PRIVILEGES in the public schema (new tables and functions are open to the
--     API roles). Recreating this lets the tests catch a migration that forgot to revoke access.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Supabase default privileges (this is what makes "forgot to revoke" dangerous):
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Minimal STAND-IN for Supabase Storage's schema (the real one is created by Supabase itself). Just enough for the product-images
-- migration's bucket row and storage.objects policies. Not a model of Storage's behaviour (signed URLs, size and MIME enforcement).
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
