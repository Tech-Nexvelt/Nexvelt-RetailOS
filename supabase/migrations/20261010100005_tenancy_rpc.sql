-- M0005 tenancy functions: platform tenant creation and membership management.
-- All writes to membership tables go through here so authority is checked in one place.
--
-- Who may do what
--  * Platform administrator: create a tenant (MFA required). Gets NO access to tenant data.
--  * Owner (staff.manage at tenant level): invite and disable anyone, assign any branch role.
--  * Branch manager (staff.manage in a branch): add and disable CASHIERS of their own branch only.
--    Cannot create managers or owners, cannot change an existing person's role, cannot touch other
--    branches, cannot re-enable someone the owner disabled.
--  * Nobody can change their own membership or role.

create or replace function public.platform_create_tenant(
  p_code text, p_legal_name text, p_trade_name text, p_owner_user uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_owner_role uuid;
begin
  if (select auth.uid()) is null then perform private.fail('UNAUTHENTICATED'); end if;
  if not private.is_platform_admin() then perform private.fail('FORBIDDEN'); end if;
  if coalesce((select auth.jwt()) ->> 'aal', '') <> 'aal2' then perform private.fail('MFA_REQUIRED'); end if;
  if not exists (select 1 from public.profiles where id = p_owner_user and status = 'ACTIVE') then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'owner'));
  end if;

  insert into public.tenants (code, legal_name, trade_name) values (upper(p_code), p_legal_name, p_trade_name)
    returning id into v_tenant;
  insert into public.tenant_settings (tenant_id) values (v_tenant);
  select id into v_owner_role from public.roles where key = 'tenant_owner' and tenant_id is null;
  insert into public.tenant_memberships (tenant_id, user_id, role_id, invited_by)
    values (v_tenant, p_owner_user, v_owner_role, (select auth.uid()));

  perform private.write_audit(v_tenant, null, 'platform.tenant_create', 'tenant', v_tenant,
                              null, jsonb_build_object('code', upper(p_code)), null, null);
  return v_tenant;
end;
$$;

create or replace function private.is_tenant_owner(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships tm join public.roles r on r.id = tm.role_id
    where tm.tenant_id = p_tenant and tm.user_id = (select auth.uid())
      and tm.status = 'ACTIVE' and r.key = 'tenant_owner'
  );
$$;

-- Grant a user access to a tenant (and optionally to branches). Called by the server AFTER it has
-- invited the person through Supabase Auth. The caller's authority is re-checked here; the role is
-- looked up by key from the roles table and is never read from anything the invitee controls.
--   p_branch_roles: [{"branchId":"<uuid>","role":"cashier"|"branch_manager"}]
create or replace function public.membership_grant(
  p_tenant uuid, p_user uuid, p_tenant_role text, p_branch_roles jsonb default '[]'::jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role uuid;
  v_owner_level boolean;
  v_existing public.tenant_memberships;
  v_existing_is_owner boolean;
  v_item jsonb;
  v_branch uuid;
  v_branch_role uuid;
  v_branch_role_key text;
  v_current_key text;
begin
  if v_actor is null then perform private.fail('UNAUTHENTICATED'); end if;
  if jsonb_typeof(p_branch_roles) is distinct from 'array' then perform private.fail('VALIDATION_ERROR'); end if;
  if p_user = v_actor then perform private.fail('FORBIDDEN'); end if;   -- nobody edits their own access

  v_owner_level := coalesce(private.has_tenant_permission(p_tenant, 'staff.manage'), false);
  if not v_owner_level and private.has_any_permission(p_tenant, 'staff.manage') is not true then
    perform private.fail('FORBIDDEN');
  end if;

  select id into v_role from public.roles
    where key = p_tenant_role and scope = 'TENANT' and tenant_id is null;
  if v_role is null then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'role')); end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'ACTIVE') then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'user'));
  end if;

  select * into v_existing from public.tenant_memberships where tenant_id = p_tenant and user_id = p_user;
  select exists (
    select 1 from public.tenant_memberships tm join public.roles r on r.id = tm.role_id
    where tm.tenant_id = p_tenant and tm.user_id = p_user and r.key = 'tenant_owner'
  ) into v_existing_is_owner;

  -- Only an owner may create or change an owner.
  if (p_tenant_role = 'tenant_owner' or v_existing_is_owner) and not private.is_tenant_owner(p_tenant) then
    perform private.fail('FORBIDDEN');
  end if;

  if not v_owner_level then
    -- Branch-manager mode: add cashiers to branches they manage, nothing more.
    if p_tenant_role <> 'tenant_member' or jsonb_array_length(p_branch_roles) = 0 then perform private.fail('FORBIDDEN'); end if;
    if v_existing.id is not null and v_existing.status <> 'ACTIVE' then perform private.fail('FORBIDDEN'); end if;
  end if;

  if v_existing.id is null then
    insert into public.tenant_memberships (tenant_id, user_id, role_id, status, invited_by)
      values (p_tenant, p_user, v_role, 'ACTIVE', v_actor);
  elsif v_owner_level then
    update public.tenant_memberships set role_id = v_role, status = 'ACTIVE' where id = v_existing.id;
  end if;   -- branch managers never change an existing tenant membership

  for v_item in select * from jsonb_array_elements(p_branch_roles) loop
    v_branch := nullif(v_item ->> 'branchId', '')::uuid;
    if v_branch is null or not exists (select 1 from public.branches where id = v_branch and tenant_id = p_tenant) then
      perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'branchId'));
    end if;
    v_branch_role_key := v_item ->> 'role';
    select id into v_branch_role from public.roles
      where key = v_branch_role_key and scope = 'BRANCH' and tenant_id is null;
    if v_branch_role is null then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'branchRole')); end if;

    if not v_owner_level then
      if v_branch_role_key <> 'cashier' or private.has_branch_permission(v_branch, 'staff.manage') is not true then
        perform private.fail('FORBIDDEN');
      end if;
      select r.key into v_current_key from public.branch_memberships bm join public.roles r on r.id = bm.role_id
        where bm.branch_id = v_branch and bm.user_id = p_user;
      if v_current_key is not null and v_current_key <> 'cashier' then perform private.fail('FORBIDDEN'); end if;
    end if;

    insert into public.branch_memberships (tenant_id, branch_id, user_id, role_id, status)
      values (p_tenant, v_branch, p_user, v_branch_role, 'ACTIVE')
    on conflict (branch_id, user_id) do update set role_id = excluded.role_id, status = 'ACTIVE';
  end loop;
end;
$$;

-- Disable / re-enable a person for the whole business. Owner-level only.
create or replace function public.membership_set_status(p_tenant uuid, p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_target_is_owner boolean;
  v_other_owners integer;
begin
  perform private.assert_tenant_permission(p_tenant, 'staff.manage');
  if p_user = (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if p_status not in ('ACTIVE', 'DISABLED') then perform private.fail('VALIDATION_ERROR'); end if;

  select exists (
    select 1 from public.tenant_memberships tm join public.roles r on r.id = tm.role_id
    where tm.tenant_id = p_tenant and tm.user_id = p_user and r.key = 'tenant_owner'
  ) into v_target_is_owner;

  if v_target_is_owner then
    if not private.is_tenant_owner(p_tenant) then perform private.fail('FORBIDDEN'); end if;
    if p_status = 'DISABLED' then
      select count(*) into v_other_owners
      from public.tenant_memberships tm join public.roles r on r.id = tm.role_id
      where tm.tenant_id = p_tenant and tm.user_id <> p_user and tm.status = 'ACTIVE' and r.key = 'tenant_owner';
      if v_other_owners = 0 then perform private.fail('LAST_OWNER'); end if;
    end if;
  end if;

  update public.tenant_memberships set status = p_status where tenant_id = p_tenant and user_id = p_user;
  if not found then perform private.fail('NOT_FOUND'); end if;
  -- Disabling cascades to branch access. Re-enabling does NOT silently restore branch roles:
  -- they must be granted again (least privilege).
  if p_status = 'DISABLED' then
    update public.branch_memberships set status = 'DISABLED' where tenant_id = p_tenant and user_id = p_user;
  end if;
end;
$$;

-- Disable / re-enable a person's access to ONE branch. Owner: any role. Branch manager: cashiers only.
create or replace function public.branch_membership_set_status(p_branch uuid, p_user uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_key text;
begin
  perform private.assert_branch_permission(p_branch, 'staff.manage');
  if p_user = (select auth.uid()) then perform private.fail('FORBIDDEN'); end if;
  if p_status not in ('ACTIVE', 'DISABLED') then perform private.fail('VALIDATION_ERROR'); end if;
  select tenant_id into v_tenant from public.branches where id = p_branch;

  select r.key into v_key from public.branch_memberships bm join public.roles r on r.id = bm.role_id
    where bm.branch_id = p_branch and bm.user_id = p_user;
  if v_key is null then perform private.fail('NOT_FOUND'); end if;
  if v_key <> 'cashier' and private.has_tenant_permission(v_tenant, 'staff.manage') is not true then
    perform private.fail('FORBIDDEN');
  end if;
  if p_status = 'ACTIVE' and not exists (
       select 1 from public.tenant_memberships where tenant_id = v_tenant and user_id = p_user and status = 'ACTIVE') then
    perform private.fail('FORBIDDEN');
  end if;
  update public.branch_memberships set status = p_status where branch_id = p_branch and user_id = p_user;
end;
$$;

revoke execute on function public.platform_create_tenant(text, text, text, uuid) from public, anon;
revoke execute on function public.membership_grant(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.membership_set_status(uuid, uuid, text) from public, anon;
revoke execute on function public.branch_membership_set_status(uuid, uuid, text) from public, anon;
grant execute on function public.platform_create_tenant(text, text, text, uuid) to authenticated;
grant execute on function public.membership_grant(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.membership_set_status(uuid, uuid, text) to authenticated;
grant execute on function public.branch_membership_set_status(uuid, uuid, text) to authenticated;
grant execute on function private.is_tenant_owner(uuid) to authenticated;
