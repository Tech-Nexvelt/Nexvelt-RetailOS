-- TEST-ONLY fixture: a database that is NOT a fresh dedicated project. It is deliberately small and is used
-- only by tests that prove the migration REFUSES such a target. It is not a copy of any real project.
-- It has the three tell-tale signs the guard looks for: an existing `retailos` schema, an application table
-- and function in `public`, and an application trigger on `auth.users`.
create schema retailos;
create table retailos.some_other_table (id uuid primary key);
create table public.stores (id uuid primary key default gen_random_uuid(), name text);
create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trg_on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
