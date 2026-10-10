-- M0002 tenancy: tenants, branches, counters, profiles, memberships, roles, permissions.
-- Roles and permissions are reference data inserted here so every environment gets the same set.

-- ---------------------------------------------------------------------------------------------
-- Permissions and roles (global reference data)
-- ---------------------------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  scope        text not null check (scope in ('TENANT', 'BRANCH')),
  description  text not null,
  is_sensitive boolean not null default false,
  -- Owner-only permissions can never be handed out as an exception to anyone else.
  delegable    boolean not null default true
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,                                    -- null = system role
  key         text not null,
  name        text not null,
  scope       text not null check (scope in ('TENANT', 'BRANCH')),
  is_system   boolean not null default true,
  unique nulls not distinct (tenant_id, key),
  unique (id, scope)
);

create table public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key),
  primary key (role_id, permission_key)
);

-- ---------------------------------------------------------------------------------------------
-- The permission catalogue. Code and policies check THESE keys, never role names.
-- TENANT scope: applies business-wide. BRANCH scope: evaluated inside one branch.
-- ---------------------------------------------------------------------------------------------
insert into public.permissions (key, scope, description, is_sensitive, delegable) values
  -- sales and payments (branch)
  ('sale.create',        'BRANCH', 'Create invoices at the counter', false, true),
  ('sale.view',          'BRANCH', 'View today''s invoices of the branch', false, true),
  ('sale.view_history',  'BRANCH', 'View the full invoice history of the branch', false, true),
  ('sale.void',          'BRANCH', 'Void an invoice (same day, with a reason)', true, true),
  ('sale.return',        'BRANCH', 'Take returns and exchanges', true, true),
  ('payment.record',     'BRANCH', 'Record cash, UPI and card payments on a sale', false, true),
  ('payment.refund',     'BRANCH', 'Refund money to a customer', true, true),
  ('discount.apply',     'BRANCH', 'Give discounts up to the configured limit', true, true),
  ('discount.override',  'BRANCH', 'Give any discount, beyond the configured limit', true, true),
  ('cash_session.manage','BRANCH', 'Start and close the day at a counter', false, true),
  -- catalogue and stock
  ('product.view',       'TENANT', 'See products, variants, jewellery and categories', false, true),
  ('product.create',     'TENANT', 'Create products, variants, designs and barcodes', false, true),
  ('product.edit',       'TENANT', 'Edit products, variants and jewellery items', false, true),
  ('product.price_edit', 'TENANT', 'Change selling prices of existing products', true, true),
  ('cost.view',          'TENANT', 'See purchase costs', true, true),
  ('cost.manage',        'TENANT', 'Edit purchase costs', true, true),
  ('inventory.view',     'BRANCH', 'View stock levels and movements', false, true),
  ('inventory.adjust',   'BRANCH', 'Adjust stock with a reason', true, true),
  ('purchase.manage',    'BRANCH', 'Receive goods and manage suppliers', false, true),
  -- pricing configuration
  ('metal_rate.view',    'TENANT', 'See metal rates', false, true),
  ('metal_rate.set',     'TENANT', 'Set metal rates', true, true),
  ('tax.manage',         'TENANT', 'Configure tax classes and rates', true, true),
  -- reports and customers
  ('report.view',        'BRANCH', 'View reports', false, true),
  ('report.export',      'BRANCH', 'Export reports and business data', true, true),
  ('customer.view',      'TENANT', 'See customer records', false, true),
  ('customer.manage',    'TENANT', 'Create and edit customer records', false, true),
  ('audit.view',         'TENANT', 'View the audit log', true, true),
  -- people and configuration
  ('staff.manage',       'BRANCH', 'Invite and disable staff (a branch manager: cashiers of their own branch)', true, true),
  ('roles.manage',       'TENANT', 'Grant or deny individual permissions and set discount limits', true, false),
  ('branch.manage',      'TENANT', 'Create and edit branches and counters', true, false),
  ('settings.manage',    'TENANT', 'Edit the business profile, tax switches and subscription', true, false);

insert into public.roles (key, name, scope) values
  ('tenant_owner',  'Owner',          'TENANT'),
  ('tenant_member', 'Staff member',   'TENANT'),
  ('branch_manager','Branch manager', 'BRANCH'),
  ('cashier',       'Cashier',        'BRANCH');

-- Owner: every permission. This is also how the owner reaches every branch of the business.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'tenant_owner';

-- Branch manager defaults: run a branch day to day. NO prices, costs, tax, metal rates, roles,
-- settings, exports, refunds or discount override. The owner can add exceptions per person.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p on p.key in (
  'sale.create', 'sale.view', 'sale.view_history', 'sale.void', 'sale.return', 'payment.record',
  'discount.apply', 'cash_session.manage',
  'product.view', 'product.create', 'product.edit',
  'inventory.view', 'inventory.adjust', 'purchase.manage',
  'metal_rate.view', 'report.view', 'customer.view', 'customer.manage', 'staff.manage')
where r.key = 'branch_manager';

-- Cashier defaults: sell, take payment, find products, start the day. Nothing else.
-- "Sales" history, discounts and returns are explicit exceptions the owner may add.
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r join public.permissions p on p.key in (
  'sale.create', 'payment.record', 'product.view', 'cash_session.manage')
where r.key = 'cashier';

-- tenant_member intentionally has no permissions: it only proves membership of the tenant.

-- ---------------------------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  legal_name  text not null check (length(btrim(legal_name)) > 0),
  trade_name  text not null check (length(btrim(trade_name)) > 0),
  status      text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  gstin       text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code  char(2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id)
);
create trigger tenants_updated before update on public.tenants
  for each row execute function private.set_updated_at();

-- Settings are NULL until the client decides them. A NULL means "not configured" and the
-- feature that depends on it refuses to run. Nothing here carries an invented default for tax.
create table public.tenant_settings (
  tenant_id                    uuid primary key references public.tenants (id) on delete cascade,
  tax_enforced                 boolean not null default true,   -- billing is blocked until tax is configured (OQ-09..11)
  prices_include_tax_clothing  boolean,                         -- NULL = not configured (OQ-11)
  prices_include_tax_jewellery boolean,                         -- NULL = not configured (OQ-11)
  allow_negative_stock         boolean not null default false,  -- OQ-25
  financial_year_start_month   smallint not null default 4 check (financial_year_start_month between 1 and 12), -- OQ-36
  updated_at                   timestamptz not null default now()
);
create trigger tenant_settings_updated before update on public.tenant_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Branches and counters
-- ---------------------------------------------------------------------------------------------
create table public.branches (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  code           text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name           text not null check (length(btrim(name)) > 0),
  state_code     char(2) not null,
  gstin          text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  timezone       text not null default 'Asia/Kolkata',
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{0,6}$'),
  status         text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);
create index branches_tenant_idx on public.branches (tenant_id);
create trigger branches_updated before update on public.branches
  for each row execute function private.set_updated_at();

create or replace function private.branch_today(p_branch uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce((select timezone from public.branches where id = p_branch), 'Asia/Kolkata'))::date;
$$;

create table public.counters (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  branch_id  uuid not null,
  code       text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name       text not null,
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (branch_id, code),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id) on delete restrict
);
create index counters_branch_idx on public.counters (tenant_id, branch_id);

-- ---------------------------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------------------------
-- A profile row is created for every auth user. It carries a display name and NOTHING that grants
-- access. Roles come only from the membership tables, never from sign-up metadata.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete restrict,
  full_name  text not null default '',
  phone      text,
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create table public.platform_admins (
  user_id    uuid primary key references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.tenant_memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  user_id    uuid not null references public.profiles (id) on delete restrict,
  role_id    uuid not null,
  role_scope text generated always as ('TENANT') stored,
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  foreign key (role_id, role_scope) references public.roles (id, scope)
);
create index tenant_memberships_user_idx on public.tenant_memberships (user_id, status);
create trigger tenant_memberships_updated before update on public.tenant_memberships
  for each row execute function private.set_updated_at();

create table public.branch_memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  branch_id  uuid not null,
  user_id    uuid not null,
  role_id    uuid not null,
  role_scope text generated always as ('BRANCH') stored,
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, user_id),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id) on delete restrict,
  -- a branch member must already be a member of the same tenant
  foreign key (tenant_id, user_id) references public.tenant_memberships (tenant_id, user_id) on delete restrict,
  foreign key (role_id, role_scope) references public.roles (id, scope)
);
create index branch_memberships_user_idx on public.branch_memberships (user_id, status);
create trigger branch_memberships_updated before update on public.branch_memberships
  for each row execute function private.set_updated_at();

-- Exceptions to the role defaults, for one person (optionally in one branch). DENY always wins over
-- GRANT. They sit on top of an existing membership and never create access by themselves.
-- Written only by the function permission_override_set, which requires roles.manage, forbids
-- targeting yourself or an owner, and refuses owner-only permissions.
create table public.permission_overrides (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  user_id        uuid not null,
  branch_id      uuid,                              -- null = everywhere in the tenant
  permission_key text not null references public.permissions (key),
  effect         text not null check (effect in ('GRANT', 'DENY')),
  reason         text not null check (length(btrim(reason)) > 0),
  granted_by     uuid not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,
  check (expires_at is null or expires_at > created_at),
  unique nulls not distinct (tenant_id, user_id, branch_id, permission_key),
  foreign key (tenant_id, user_id) references public.tenant_memberships (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id) on delete cascade
);
create index permission_overrides_user_idx on public.permission_overrides (user_id, tenant_id);

-- Largest line discount a role may give with discount.apply, without needing discount.override, in basis points (100 = 1%).
-- No row = 0 = no discount. The client has not decided these limits yet (OQ-21).
create table public.role_discount_limits (
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  role_id              uuid not null references public.roles (id) on delete cascade,
  max_line_discount_bps integer not null check (max_line_discount_bps between 0 and 10000),
  primary key (tenant_id, role_id)
);
