-- M0003 authorisation helpers and Row Level Security for the tenancy tables.
--
-- Model
--  * A user acts in a tenant through an ACTIVE tenant membership (one tenant role).
--  * A user acts in a branch through an ACTIVE branch membership (one branch role) which requires
--    an ACTIVE tenant membership in the same tenant (composite foreign key).
--  * A tenant-scoped role that carries BRANCH-scope permissions (the owner) applies to every branch.
--  * Suspended tenants and inactive branches grant nothing.
--  * EFFECTIVE permission = role defaults, plus GRANT exceptions, minus DENY exceptions (DENY wins).
--    Exceptions never create access on their own: they sit on top of an existing membership.
--  * Permissions come ONLY from the membership and override tables. Never from JWT metadata,
--    sign-up data or anything the browser sends.

-- ---------------------------------------------------------------------------------------------
-- Helper functions. SECURITY DEFINER so they can read membership tables without recursion through
-- RLS; search_path is empty so nothing can be shadowed; every object is schema-qualified.
-- ---------------------------------------------------------------------------------------------
create or replace function private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.revoked_at is null
  );
$$;

create or replace function private.has_tenant_access(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    join public.tenants t on t.id = tm.tenant_id
    where tm.tenant_id = p_tenant
      and tm.user_id = (select auth.uid())
      and tm.status = 'ACTIVE'
      and t.status = 'ACTIVE'
  );
$$;

-- The current user's exception for a permission here: 'DENY', 'GRANT' or null. DENY wins.
-- p_branch null means tenant-wide exceptions only.
create or replace function private.override_effect(p_tenant uuid, p_branch uuid, p_perm text)
returns text
language sql stable security definer set search_path = ''
as $$
  select o.effect
  from public.permission_overrides o
  where o.tenant_id = p_tenant
    and o.user_id = (select auth.uid())
    and o.permission_key = p_perm
    and (o.expires_at is null or o.expires_at > now())
    and (o.branch_id is null or o.branch_id = p_branch)
  order by (o.effect = 'DENY') desc
  limit 1;
$$;

-- Tenant-wide permission: tenant role defaults +/- tenant-wide exceptions.
create or replace function private.has_tenant_permission(p_tenant uuid, p_perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_tenant_access(p_tenant)
     and private.override_effect(p_tenant, null, p_perm) is distinct from 'DENY'
     and (
       exists (
         select 1
         from public.tenant_memberships tm
         join public.role_permissions rp on rp.role_id = tm.role_id
         where tm.tenant_id = p_tenant
           and tm.user_id = (select auth.uid())
           and tm.status = 'ACTIVE'
           and rp.permission_key = p_perm
       )
       or coalesce(private.override_effect(p_tenant, null, p_perm) = 'GRANT', false)
     );
$$;

-- Permission via the tenant role OR via any ACTIVE branch membership in the tenant (tenant-wide
-- exceptions apply). Used for tenant-wide master data that branch staff may use, e.g. product.view.
create or replace function private.has_any_permission(p_tenant uuid, p_perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_tenant_access(p_tenant)
     and private.override_effect(p_tenant, null, p_perm) is distinct from 'DENY'
     and (
       exists (
         select 1
         from public.tenant_memberships tm
         join public.role_permissions rp on rp.role_id = tm.role_id
         where tm.tenant_id = p_tenant and tm.user_id = (select auth.uid())
           and tm.status = 'ACTIVE' and rp.permission_key = p_perm
       )
       or exists (
         select 1
         from public.branch_memberships bm
         join public.branches b on b.id = bm.branch_id and b.status = 'ACTIVE'
         join public.tenant_memberships tm
           on tm.tenant_id = bm.tenant_id and tm.user_id = bm.user_id and tm.status = 'ACTIVE'
         join public.role_permissions rp on rp.role_id = bm.role_id
         where bm.tenant_id = p_tenant and bm.user_id = (select auth.uid())
           and bm.status = 'ACTIVE' and rp.permission_key = p_perm
       )
       or coalesce(private.override_effect(p_tenant, null, p_perm) = 'GRANT', false)
     );
$$;

-- May the user see this branch at all? (Exceptions never create access.)
create or replace function private.has_branch_access(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.tenants t on t.id = b.tenant_id and t.status = 'ACTIVE'
    where b.id = p_branch
      and b.status = 'ACTIVE'
      and (
        exists (
          select 1
          from public.tenant_memberships tm
          join public.role_permissions rp on rp.role_id = tm.role_id
          join public.permissions p on p.key = rp.permission_key and p.scope = 'BRANCH'
          where tm.tenant_id = b.tenant_id
            and tm.user_id = (select auth.uid())
            and tm.status = 'ACTIVE'
        )
        or exists (
          select 1
          from public.branch_memberships bm
          join public.tenant_memberships tm
            on tm.tenant_id = bm.tenant_id and tm.user_id = bm.user_id and tm.status = 'ACTIVE'
          where bm.branch_id = b.id
            and bm.user_id = (select auth.uid())
            and bm.status = 'ACTIVE'
        )
      )
  );
$$;

-- Does the user have a permission in this specific branch?
create or replace function private.has_branch_permission(p_branch uuid, p_perm text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_branch_access(p_branch)
     and exists (
       select 1
       from public.branches b
       where b.id = p_branch
         and private.override_effect(b.tenant_id, b.id, p_perm) is distinct from 'DENY'
         and (
           -- through the tenant role (owner): all branches of the tenant
           exists (
             select 1
             from public.tenant_memberships tm
             join public.role_permissions rp on rp.role_id = tm.role_id
             where tm.tenant_id = b.tenant_id and tm.user_id = (select auth.uid())
               and tm.status = 'ACTIVE' and rp.permission_key = p_perm
           )
           -- through a branch role, only in that branch
           or exists (
             select 1
             from public.branch_memberships bm
             join public.role_permissions rp on rp.role_id = bm.role_id
             where bm.branch_id = b.id and bm.user_id = (select auth.uid())
               and bm.status = 'ACTIVE' and rp.permission_key = p_perm
           )
           -- or through an explicit exception granted by the owner
           or coalesce(private.override_effect(b.tenant_id, b.id, p_perm) = 'GRANT', false)
         )
     );
$$;

create or replace function private.shares_tenant(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    join public.tenants t on t.id = mine.tenant_id and t.status = 'ACTIVE'
    where mine.user_id = (select auth.uid()) and mine.status = 'ACTIVE'
      and theirs.user_id = p_user and theirs.status = 'ACTIVE'
  );
$$;

-- May the caller see/manage this person? Owner-level staff.manage: everyone in the tenant.
-- A branch manager: only people with a membership in a branch where the caller holds staff.manage.
create or replace function private.manages_user(p_tenant uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_tenant_permission(p_tenant, 'staff.manage')
      or exists (
        select 1 from public.branch_memberships bm
        where bm.tenant_id = p_tenant and bm.user_id = p_user and bm.status = 'ACTIVE'
          and private.has_branch_permission(bm.branch_id, 'staff.manage')
      );
$$;

create or replace function private.branch_today(p_branch uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone b.timezone)::date from public.branches b where b.id = p_branch;
$$;

-- The line-discount limit (basis points) the user holds in a branch.
--   discount.override -> unlimited;  discount.apply -> the largest configured limit of their roles;
--   neither -> 0 (default deny).
create or replace function private.discount_limit_bps(p_branch uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case
    when private.has_branch_permission(p_branch, 'discount.override') then 10000
    when not private.has_branch_permission(p_branch, 'discount.apply') then 0
    else coalesce((
      select max(l.max_line_discount_bps)
      from public.branches b
      join public.role_discount_limits l on l.tenant_id = b.tenant_id
      where b.id = p_branch
        and l.role_id in (
          select tm.role_id from public.tenant_memberships tm
            where tm.tenant_id = b.tenant_id and tm.user_id = (select auth.uid()) and tm.status = 'ACTIVE'
          union
          select bm.role_id from public.branch_memberships bm
            join public.tenant_memberships tm2
              on tm2.tenant_id = bm.tenant_id and tm2.user_id = bm.user_id and tm2.status = 'ACTIVE'
            where bm.branch_id = b.id and bm.user_id = (select auth.uid()) and bm.status = 'ACTIVE'
        )
    ), 0)
  end;
$$;

-- Raise UNAUTHENTICATED / FORBIDDEN. Call first in every privileged function.
-- NOTE: a permission helper must never be allowed to answer NULL, and these guards refuse unless the
-- answer is exactly TRUE, so an unexpected NULL can only deny, never grant.
create or replace function private.assert_branch_permission(p_branch uuid, p_perm text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('UNAUTHENTICATED');
  end if;
  if private.has_branch_permission(p_branch, p_perm) is not true then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

create or replace function private.assert_tenant_permission(p_tenant uuid, p_perm text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('UNAUTHENTICATED');
  end if;
  if private.has_tenant_permission(p_tenant, p_perm) is not true then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

create or replace function private.assert_any_permission(p_tenant uuid, p_perm text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    perform private.fail('UNAUTHENTICATED');
  end if;
  if private.has_any_permission(p_tenant, p_perm) is not true then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

-- Helpers are callable by signed-in users only (policies run with the caller's privileges).
revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.is_platform_admin(), private.has_tenant_access(uuid), private.override_effect(uuid, uuid, text),
  private.has_tenant_permission(uuid, text), private.has_any_permission(uuid, text),
  private.has_branch_permission(uuid, text), private.has_branch_access(uuid), private.shares_tenant(uuid),
  private.manages_user(uuid, uuid), private.branch_today(uuid), private.discount_limit_bps(uuid),
  private.assert_branch_permission(uuid, text), private.assert_tenant_permission(uuid, text),
  private.assert_any_permission(uuid, text)
  to authenticated, service_role;
grant execute on function private.fail(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Table privileges: start from nothing, grant only what each table needs.
-- RLS then narrows which rows. `anon` gets nothing at all.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.tenants, public.tenant_settings, public.branches, public.counters,
  public.profiles, public.permissions, public.roles, public.role_permissions,
  public.tenant_memberships, public.branch_memberships, public.role_discount_limits,
  public.permission_overrides
  to authenticated;

grant update (legal_name, trade_name, gstin, state_code) on public.tenants to authenticated;
grant update (tax_enforced, prices_include_tax_clothing, prices_include_tax_jewellery,
              allow_negative_stock, financial_year_start_month) on public.tenant_settings to authenticated;
grant insert, update on public.branches, public.counters to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant insert, update, delete on public.role_discount_limits to authenticated;
-- memberships, permission_overrides and platform_admins are changed only through SECURITY DEFINER
-- functions that check the caller's authority.

-- ---------------------------------------------------------------------------------------------
-- Row Level Security. Enabled on every table. Not FORCEd: the SECURITY DEFINER helpers run as the table
-- owner and must read membership tables without recursing through RLS. `authenticated` and `anon` are
-- always subject to the policies.
-- ---------------------------------------------------------------------------------------------
alter table public.permissions          enable row level security;
alter table public.roles                enable row level security;
alter table public.role_permissions     enable row level security;
alter table public.tenants              enable row level security;
alter table public.tenant_settings      enable row level security;
alter table public.branches             enable row level security;
alter table public.counters             enable row level security;
alter table public.profiles             enable row level security;
alter table public.platform_admins      enable row level security;
alter table public.tenant_memberships   enable row level security;
alter table public.branch_memberships   enable row level security;
alter table public.role_discount_limits enable row level security;
alter table public.permission_overrides enable row level security;

-- Reference data
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy roles_read on public.roles for select to authenticated using (tenant_id is null);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);

-- Tenants. Any member sees the business name; only settings.manage edits the profile.
create policy tenants_read on public.tenants for select to authenticated
  using (private.has_tenant_access(id));
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_tenant_permission(id, 'settings.manage'))
  with check (private.has_tenant_permission(id, 'settings.manage'));

-- Settings (tax switches etc.) are not visible to staff without settings.manage.
create policy tenant_settings_read on public.tenant_settings for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'settings.manage'));
create policy tenant_settings_update on public.tenant_settings for update to authenticated
  using (private.has_tenant_permission(tenant_id, 'settings.manage'))
  with check (private.has_tenant_permission(tenant_id, 'settings.manage'));

-- Branches and counters
create policy branches_read on public.branches for select to authenticated
  using (private.has_branch_access(id));
create policy branches_insert on public.branches for insert to authenticated
  with check (private.has_tenant_permission(tenant_id, 'branch.manage'));
create policy branches_update on public.branches for update to authenticated
  using (private.has_tenant_permission(tenant_id, 'branch.manage'))
  with check (private.has_tenant_permission(tenant_id, 'branch.manage'));

create policy counters_read on public.counters for select to authenticated
  using (private.has_branch_access(branch_id));
create policy counters_insert on public.counters for insert to authenticated
  with check (private.has_tenant_permission(tenant_id, 'branch.manage'));
create policy counters_update on public.counters for update to authenticated
  using (private.has_tenant_permission(tenant_id, 'branch.manage'))
  with check (private.has_tenant_permission(tenant_id, 'branch.manage'));

-- Profiles: yourself, and people who share a tenant with you. Edit only yourself.
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_tenant(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform_admins: no policy = no access for anyone except the service role.

-- Memberships: your own, or the people you are allowed to manage. Writes only via functions.
create policy tenant_memberships_read on public.tenant_memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.manages_user(tenant_id, user_id));
create policy branch_memberships_read on public.branch_memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.has_branch_permission(branch_id, 'staff.manage')
         or private.has_tenant_permission(tenant_id, 'staff.manage'));

-- Discount limits and per-person exceptions: visible and editable only with roles.manage
-- (people can see their own exceptions). Exceptions are written only by permission_override_set.
create policy role_discount_limits_read on public.role_discount_limits for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'roles.manage'));
create policy role_discount_limits_write on public.role_discount_limits for all to authenticated
  using (private.has_tenant_permission(tenant_id, 'roles.manage'))
  with check (private.has_tenant_permission(tenant_id, 'roles.manage'));

create policy permission_overrides_read on public.permission_overrides for select to authenticated
  using (user_id = (select auth.uid()) or private.has_tenant_permission(tenant_id, 'roles.manage'));
