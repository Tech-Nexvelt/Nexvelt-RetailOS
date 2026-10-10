-- M0012 permission management: per-person exceptions and discount limits.
--
-- Guard rails (all enforced here, in the database):
--   * Requires roles.manage at TENANT level, which only the owner holds by default.
--   * Nobody can change their own permissions.
--   * An owner's permissions cannot be reduced by exception (no accidental lock-out).
--   * Owner-only permissions (permissions.delegable = false: roles.manage, settings.manage,
--     branch.manage) can never be handed to anyone else.
--   * An exception sits on top of an existing membership; it never creates access.
--   * A branch permission can only be GRANTED for one named branch (never silently everywhere).
--   * DENY always wins over GRANT. Every change is audited by trigger.

create or replace function public.permission_override_set(
  p_tenant uuid, p_user uuid, p_branch uuid, p_permission text, p_effect text,
  p_reason text, p_expires_at timestamptz default null
) returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_perm public.permissions;
  v_id uuid;
begin
  perform private.assert_tenant_permission(p_tenant, 'roles.manage');
  if p_user = (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;   -- never your own
  if p_effect not in ('GRANT', 'DENY') or length(btrim(coalesce(p_reason, ''))) = 0 then
    perform private.fail('VALIDATION_ERROR');
  end if;

  select * into v_perm from public.permissions where key = p_permission;
  if not found then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'permission')); end if;
  if not v_perm.delegable then perform private.fail('FORBIDDEN'); end if;

  if not exists (select 1 from public.tenant_memberships where tenant_id = p_tenant and user_id = p_user and status = 'ACTIVE') then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'user'));
  end if;
  if exists (select 1 from public.tenant_memberships tm join public.roles r on r.id = tm.role_id
              where tm.tenant_id = p_tenant and tm.user_id = p_user and r.key = 'tenant_owner') then
    perform private.fail('FORBIDDEN');
  end if;

  if v_perm.scope = 'TENANT' and p_branch is not null then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'branch')); end if;
  if v_perm.scope = 'BRANCH' and p_effect = 'GRANT' and p_branch is null then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'branch'));
  end if;
  if p_branch is not null and not exists (
       select 1 from public.branch_memberships bm
        where bm.tenant_id = p_tenant and bm.branch_id = p_branch and bm.user_id = p_user and bm.status = 'ACTIVE') then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'branch'));
  end if;
  if p_expires_at is not null and p_expires_at <= now() then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'expiresAt')); end if;

  update public.permission_overrides
     set effect = p_effect, reason = p_reason, expires_at = p_expires_at, granted_by = (select auth.uid())
   where tenant_id = p_tenant and user_id = p_user and permission_key = p_permission
     and branch_id is not distinct from p_branch
  returning id into v_id;
  if v_id is null then
    insert into public.permission_overrides (tenant_id, user_id, branch_id, permission_key, effect, reason, granted_by, expires_at)
      values (p_tenant, p_user, p_branch, p_permission, p_effect, p_reason, (select auth.uid()), p_expires_at)
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.permission_override_clear(p_tenant uuid, p_user uuid, p_branch uuid, p_permission text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  perform private.assert_tenant_permission(p_tenant, 'roles.manage');
  if p_user = (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  delete from public.permission_overrides
   where tenant_id = p_tenant and user_id = p_user and permission_key = p_permission
     and branch_id is not distinct from p_branch;
  if not found then perform private.fail('NOT_FOUND'); end if;
end;
$$;

-- Set the largest discount (basis points) a role may give when it holds discount.apply.
create or replace function public.discount_limit_set(p_tenant uuid, p_role_key text, p_max_bps integer)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_role uuid;
begin
  perform private.assert_tenant_permission(p_tenant, 'roles.manage');
  if p_max_bps is null or p_max_bps < 0 or p_max_bps > 10000 then perform private.fail('VALIDATION_ERROR'); end if;
  select id into v_role from public.roles where key = p_role_key and scope = 'BRANCH' and tenant_id is null;
  if v_role is null then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'role')); end if;
  insert into public.role_discount_limits (tenant_id, role_id, max_line_discount_bps)
    values (p_tenant, v_role, p_max_bps)
  on conflict (tenant_id, role_id) do update set max_line_discount_bps = excluded.max_line_discount_bps;
end;
$$;

revoke execute on function public.permission_override_set(uuid, uuid, uuid, text, text, text, timestamptz),
  public.permission_override_clear(uuid, uuid, uuid, text), public.discount_limit_set(uuid, text, integer) from public, anon;
grant execute on function public.permission_override_set(uuid, uuid, uuid, text, text, text, timestamptz),
  public.permission_override_clear(uuid, uuid, uuid, text), public.discount_limit_set(uuid, text, integer) to authenticated;

-- Discount limits are changed only through discount_limit_set (above), never by direct writes.
revoke insert, update, delete on public.role_discount_limits from authenticated;
drop policy if exists role_discount_limits_write on public.role_discount_limits;
