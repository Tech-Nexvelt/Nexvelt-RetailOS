-- RETAILOS migration for a DEDICATED Supabase project: schema marker. HAND-WRITTEN (not generated).
-- Sealed in SHA256SUMS and pinned in ../MANIFEST.sha256.
--
-- A single, write-once row that says which application and which migration set own this schema. Verification
-- tools read it to confirm "this really is the RetailOS project, at the expected version", instead of relying
-- only on a catalog hash. It is not reachable through the Data API: no API role has any privilege on it.

create table retailos.schema_info (
  app            text primary key check (app = 'retailos'),
  schema_version integer not null check (schema_version > 0),
  migration_set  text not null,
  created_at     timestamptz not null default now(),
  created_by     text not null default current_user
);
alter table retailos.schema_info enable row level security;   -- no policies: nobody but the owner can read it
revoke all on retailos.schema_info from anon, authenticated;

create or replace function retailos_private.schema_info_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'schema_info is write-once' using errcode = '42501';
end;
$$;
create trigger schema_info_no_change before update or delete on retailos.schema_info
  for each row execute function retailos_private.schema_info_immutable();
create trigger schema_info_no_truncate before truncate on retailos.schema_info
  for each statement execute function retailos_private.schema_info_immutable();

insert into retailos.schema_info (app, schema_version, migration_set)
values ('retailos', 1, 'dedicated-project-v1');

revoke execute on function retailos_private.schema_info_immutable() from public, anon;
