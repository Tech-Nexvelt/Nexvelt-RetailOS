-- M0004 audit log: append-only, written only by trusted code.

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid,
  branch_id     uuid,
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  actor_type    text not null default 'USER' check (actor_type in ('USER', 'PLATFORM_ADMIN', 'SYSTEM')),
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  reason        text,
  metadata      jsonb
);
create index audit_logs_tenant_time_idx on public.audit_logs (tenant_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (tenant_id, entity_type, entity_id);

-- No UPDATE, DELETE or TRUNCATE for anyone: not the application roles, not the service role.
create or replace function private.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- Trusted writer, callable only from other SECURITY DEFINER code.
create or replace function private.write_audit(
  p_tenant uuid, p_branch uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null,
  p_metadata jsonb default null
) returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (tenant_id, branch_id, actor_user_id, action, entity_type, entity_id,
                                 before, after, reason, metadata)
  values (p_tenant, p_branch, (select auth.uid()), p_action, p_entity_type, p_entity_id,
          p_before, p_after, p_reason, p_metadata);
$$;

-- Generic trigger: records before/after of any change to a master-data row.
-- Usage: create trigger ... after insert or update or delete on <table>
--          for each row execute function private.audit_row_change('<entity_type>');
create or replace function private.audit_row_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  insert into public.audit_logs (tenant_id, branch_id, actor_user_id, action, entity_type, entity_id, before, after)
  values (
    nullif(coalesce(v_row ->> 'tenant_id', case when tg_table_name = 'tenants' then v_row ->> 'id' end), '')::uuid,
    nullif(v_row ->> 'branch_id', '')::uuid,
    (select auth.uid()),
    lower(tg_argv[0]) || '.' || lower(tg_op),
    tg_argv[0],
    nullif(coalesce(v_row ->> 'id', v_row ->> 'variant_id', v_row ->> 'tenant_id'), '')::uuid,
    v_old, v_new
  );
  return null;
end;
$$;

create trigger tenants_audit after insert or update on public.tenants
  for each row execute function private.audit_row_change('tenant');
create trigger tenant_settings_audit after insert or update on public.tenant_settings
  for each row execute function private.audit_row_change('tenant_settings');
create trigger branches_audit after insert or update on public.branches
  for each row execute function private.audit_row_change('branch');
create trigger role_discount_limits_audit after insert or update or delete on public.role_discount_limits
  for each row execute function private.audit_row_change('role_discount_limit');
create trigger tenant_memberships_audit after insert or update on public.tenant_memberships
  for each row execute function private.audit_row_change('tenant_membership');
create trigger branch_memberships_audit after insert or update on public.branch_memberships
  for each row execute function private.audit_row_change('branch_membership');
create trigger permission_overrides_audit after insert or update or delete on public.permission_overrides
  for each row execute function private.audit_row_change('permission_override');

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (tenant_id is not null and private.has_tenant_permission(tenant_id, 'audit.view'));

revoke execute on function private.write_audit(uuid, uuid, text, text, uuid, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
