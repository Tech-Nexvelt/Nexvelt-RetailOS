-- M0001 foundation: schemas, shared helpers.
-- Applied on Supabase, where roles (anon, authenticated, service_role) and the auth schema
-- already exist. Nothing here creates them. No extensions are required: gen_random_uuid() and sha256()
-- are built into PostgreSQL 13+.


create schema if not exists private;
comment on schema private is
  'Helper functions and internals. NOT exposed through the Data API (keep it out of the exposed schemas list in Supabase settings).';

-- RLS policies call helpers in this schema with the caller''s privileges, so the roles need USAGE.
-- EXECUTE is granted function by function, never schema-wide.
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
-- PostgreSQL grants EXECUTE on every new function to PUBLIC. Only a GLOBAL default-privilege change
-- (no "in schema") can remove that, so every function created from here on is closed by default
-- and opened with an explicit GRANT.
alter default privileges revoke execute on functions from public;

-- Never hand out table privileges by default. Every grant below is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Raise a business error. The message is a stable code the application maps to plain language.
-- detail carries optional JSON (for example the item id) for the caller.
create or replace function private.fail(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail::text, '');
end;
$$;
