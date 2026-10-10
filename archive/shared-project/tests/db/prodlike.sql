-- TEST-ONLY. Re-creates the shape of the LIVE Supabase project as audited on 2026-10-10 (read-only),
-- so the ported migrations are proven to apply on top of it without disturbing it.
-- Tirumala side (schema public): only the parts that matter for collisions and isolation.
create table public.stores (id uuid primary key default gen_random_uuid(), name text);
create table public.profiles (
  id uuid primary key references auth.users (id), store_id uuid references public.stores (id),
  full_name text, role text, phone text, avatar_url text, is_active boolean default true,
  last_login timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.categories (id uuid primary key default gen_random_uuid(), store_id uuid, name text, deleted_at timestamptz);
create table public.products (id uuid primary key default gen_random_uuid(), store_id uuid, name text, deleted_at timestamptz);
create table public.invoices (id uuid primary key default gen_random_uuid(), store_id uuid, deleted_at timestamptz);
create table public.invoice_items (id uuid primary key default gen_random_uuid(), invoice_id uuid);
create table public.payments (id uuid primary key default gen_random_uuid(), invoice_id uuid);
create table public.mobile_scans (id uuid primary key default gen_random_uuid(), store_id uuid, barcode text, created_at timestamptz default now(), processed boolean default false);
create table public.audit_log (id uuid primary key default gen_random_uuid(), store_id uuid);

create function public.get_my_store_id() returns uuid language sql stable security definer as $$ select store_id from profiles where id = auth.uid() $$;
create function public.is_admin() returns boolean language sql stable security definer as $$ select role = 'admin' from profiles where id = auth.uid() $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), coalesce(new.raw_user_meta_data->>'role', 'admin'))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger trg_on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.invoices enable row level security;
alter table public.mobile_scans enable row level security;
create policy profiles_select on public.profiles for select to anon, authenticated, service_role using (store_id = get_my_store_id() or id = auth.uid());
create policy products_select on public.products for select using (store_id = get_my_store_id() and (deleted_at is null or is_admin()));
create policy invoices_select on public.invoices for select using (store_id = get_my_store_id() and deleted_at is null);
create policy "Anyone can insert mobile scans" on public.mobile_scans for insert with check (true);
create policy "Store users can read their scans" on public.mobile_scans for select using (auth.uid() is not null);

-- RetailOS side as deployed: schema retailos with its default privileges, 10 empty tables, 2 helpers in public.
create schema retailos;
grant usage on schema retailos to authenticated;
alter default privileges for role postgres in schema retailos grant select on tables to authenticated;

create table retailos.retailos_tenants (id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  status text not null default 'active' check (status in ('active','suspended')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table retailos.retailos_branches (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references retailos.retailos_tenants(id) on delete restrict,
  name text not null, code text not null, address text, is_active boolean not null default true, created_at timestamptz not null default now(),
  unique (tenant_id, code), unique (tenant_id, id));
create table retailos.retailos_memberships (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references retailos.retailos_tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict, role text not null check (role in ('owner','cashier','branch_manager')),
  branch_id uuid, is_active boolean not null default true, created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references retailos.retailos_branches(tenant_id, id) on delete restrict, unique (tenant_id, user_id, branch_id));
create table retailos.retailos_products (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references retailos.retailos_tenants(id) on delete restrict,
  name text not null, category text, product_type text not null default 'standard', description text, image_path text, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, id));
create table retailos.retailos_product_variants (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, product_id uuid not null, sku text not null,
  barcode text, variant_name text, size text, color text, unit_price_paise bigint not null check (unit_price_paise >= 0), cost_price_paise bigint check (cost_price_paise is null or cost_price_paise >= 0),
  tracking_type text not null default 'quantity', is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, id), unique (tenant_id, sku), foreign key (tenant_id, product_id) references retailos.retailos_products(tenant_id, id) on delete restrict);
create table retailos.retailos_inventory (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, variant_id uuid not null,
  quantity numeric not null default 0 check (quantity >= 0), updated_at timestamptz not null default now(), unique (branch_id, variant_id),
  foreign key (tenant_id, branch_id) references retailos.retailos_branches(tenant_id, id), foreign key (tenant_id, variant_id) references retailos.retailos_product_variants(tenant_id, id));
create table retailos.retailos_sales (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, invoice_number text not null,
  cashier_user_id uuid not null references auth.users(id), status text not null default 'completed', subtotal_paise bigint not null, discount_paise bigint not null default 0,
  tax_paise bigint not null default 0, total_paise bigint not null check (total_paise > 0), idempotency_key text not null, notes text, completed_at timestamptz, created_at timestamptz not null default now(),
  unique (tenant_id, id), unique (tenant_id, branch_id, invoice_number), unique (tenant_id, idempotency_key), foreign key (tenant_id, branch_id) references retailos.retailos_branches(tenant_id, id));
create table retailos.retailos_sale_items (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sale_id uuid not null, variant_id uuid not null,
  product_name_snapshot text not null, sku_snapshot text not null, quantity numeric not null check (quantity > 0), unit_price_paise bigint not null, line_total_paise bigint not null,
  foreign key (tenant_id, sale_id) references retailos.retailos_sales(tenant_id, id), foreign key (tenant_id, variant_id) references retailos.retailos_product_variants(tenant_id, id));
create table retailos.retailos_payments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, sale_id uuid not null, method text not null check (method in ('cash','upi','card')),
  amount_paise bigint not null check (amount_paise > 0), status text not null default 'recorded', recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_id) references retailos.retailos_sales(tenant_id, id));
create table retailos.retailos_inventory_ledger (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null, variant_id uuid not null, sale_id uuid,
  movement_type text not null, quantity_change numeric not null check (quantity_change <> 0), reason text, performed_by uuid references auth.users(id), created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references retailos.retailos_branches(tenant_id, id));

-- live table ACL: owner + anon + authenticated + service_role all privileges; RLS on
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'retailos' loop
    execute format('grant all on retailos.%I to anon, authenticated, service_role', t);
    execute format('alter table retailos.%I enable row level security', t);
  end loop; end $$;

create function public.retailos_has_role(p_tenant_id uuid, p_roles text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from retailos.retailos_memberships m where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid()) and m.is_active and m.role = any(p_roles)) $$;
create function public.retailos_can_access_branch(p_tenant_id uuid, p_branch_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from retailos.retailos_memberships m where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid()) and m.is_active
    and (m.role = 'owner' or m.branch_id is null or m.branch_id = p_branch_id)) $$;
revoke execute on function public.retailos_has_role(uuid, text[]), public.retailos_can_access_branch(uuid, uuid) from public, anon;
create policy retailos_products_read on retailos.retailos_products for select to authenticated using (public.retailos_has_role(tenant_id, array['owner','cashier','branch_manager']));
create policy retailos_variants_read on retailos.retailos_product_variants for select to authenticated using (public.retailos_has_role(tenant_id, array['owner','cashier','branch_manager']));
create policy retailos_sales_read on retailos.retailos_sales for select to authenticated using (public.retailos_can_access_branch(tenant_id, branch_id));
create policy retailos_memberships_read on retailos.retailos_memberships for select to authenticated using (user_id = (select auth.uid()) or public.retailos_has_role(tenant_id, array['owner']));
