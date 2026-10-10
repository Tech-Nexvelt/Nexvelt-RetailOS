-- RETAILOS migration 016: PRODUCT IMAGES. HAND-WRITTEN (not generated). APPROVED by the owner 2026-10-10 (one photo per product and per
-- jewellery DESIGN). Sealed in SHA256SUMS and pinned in ../MANIFEST.sha256. Applied to an existing project, never to an empty one by itself.
--
-- Adds only: a PRIVATE bucket "product-images" (5 MB, JPEG/PNG/WebP), image_path on retailos.products and retailos.jewellery_designs
-- (the storage key, never the image), a guard so a path must belong to the same tenant, kind and row, tenant-scoped storage policies
-- (read: tenant members; upload/delete: product.edit; no UPDATE: objects are immutable, a replacement is a new file), and an audit entry
-- when a reference changes. Changes no invoice, payment, stock or ledger row and no existing function, privilege or policy.
-- Path shape: <tenant uuid>/<products|jewellery>/<product or design uuid>/<file uuid>.<jpg|png|webp>  (same as src/lib/images/validate.ts)

-- 1. bucket (private) ------------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 2. path helpers: NULL for anything that does not have exactly the expected shape ------------------------------------------
create or replace function retailos_private.image_path_ok(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(products|jewellery)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$', false);
$$;
create or replace function retailos_private.image_path_tenant(p_name text) returns uuid
language sql immutable set search_path = ''
as $$ select case when retailos_private.image_path_ok(p_name) then split_part(p_name, '/', 1)::uuid end; $$;
create or replace function retailos_private.image_path_kind(p_name text) returns text
language sql immutable set search_path = ''
as $$ select case when retailos_private.image_path_ok(p_name) then split_part(p_name, '/', 2) end; $$;
create or replace function retailos_private.image_path_owner(p_name text) returns uuid
language sql immutable set search_path = ''
as $$ select case when retailos_private.image_path_ok(p_name) then split_part(p_name, '/', 3)::uuid end; $$;
revoke execute on function retailos_private.image_path_ok(text), retailos_private.image_path_tenant(text), retailos_private.image_path_kind(text), retailos_private.image_path_owner(text) from public, anon;
grant execute on function retailos_private.image_path_ok(text), retailos_private.image_path_tenant(text), retailos_private.image_path_kind(text), retailos_private.image_path_owner(text) to authenticated;

-- 3. reference columns + guard ---------------------------------------------------------------------------------------------
alter table retailos.products add column image_path text;
alter table retailos.jewellery_designs add column image_path text;

create or replace function retailos_private.guard_image_path() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.image_path is not null and (
       retailos_private.image_path_tenant(new.image_path) is distinct from new.tenant_id
       or retailos_private.image_path_owner(new.image_path) is distinct from new.id
       or retailos_private.image_path_kind(new.image_path) is distinct from tg_argv[0]) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0001', detail = 'image_path does not belong to this row';
  end if;
  return new;
end;
$$;
-- a trigger function needs no EXECUTE grant to fire; close it like every other function in this schema (no anon, no PUBLIC)
revoke execute on function retailos_private.guard_image_path() from public, anon;
create trigger products_image_guard before insert or update of image_path on retailos.products
  for each row execute function retailos_private.guard_image_path('products');
create trigger jewellery_designs_image_guard before insert or update of image_path on retailos.jewellery_designs
  for each row execute function retailos_private.guard_image_path('jewellery');

-- 5. audit only when the reference changes (same writer the other catalogue triggers use)
create trigger products_image_audit after update of image_path on retailos.products
  for each row when (old.image_path is distinct from new.image_path) execute function retailos_private.audit_row_change('product_image');
create trigger jewellery_designs_image_audit after update of image_path on retailos.jewellery_designs
  for each row when (old.image_path is distinct from new.image_path) execute function retailos_private.audit_row_change('jewellery_image');

-- 4. storage policies ------------------------------------------------------------------------------------------------------
create policy product_images_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and retailos_private.has_tenant_access(retailos_private.image_path_tenant(name)));
create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and retailos_private.has_tenant_permission(retailos_private.image_path_tenant(name), 'product.edit'));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and retailos_private.has_tenant_permission(retailos_private.image_path_tenant(name), 'product.edit'));
