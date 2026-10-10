-- M0014 catalogue creation for the MVP: clothing products with variants and opening stock, and
-- individually tagged jewellery (imitation and fixed-price precious). Every function authorises the
-- caller itself, runs in one transaction, and is idempotent.
--
-- NOT included, by decision: weight/rate-based jewellery pricing (OQ-01/02/05/08 unanswered). Precious
-- items are created with a FIXED tag price. Their weights are recorded because the table requires them.
-- No tax rate, tax class or HSN code is invented: tax is configured separately by the owner.

-- Tenant-wide counters for generated barcodes and tag codes (internal; no API access).
create table public.tenant_sequences (
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  name        text not null check (name in ('BARCODE', 'TAG_IMITATION', 'TAG_PRECIOUS')),
  next_number bigint not null default 1 check (next_number >= 1),
  primary key (tenant_id, name)
);
alter table public.tenant_sequences enable row level security;

create or replace function private.next_tenant_number(p_tenant uuid, p_name text)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  v_next bigint;
begin
  insert into public.tenant_sequences (tenant_id, name) values (p_tenant, p_name) on conflict do nothing;
  update public.tenant_sequences set next_number = next_number + 1
   where tenant_id = p_tenant and name = p_name
   returning next_number - 1 into v_next;
  return v_next;
end;
$$;

-- Map a unique-constraint violation to a code the screen can explain.
create or replace function private.duplicate_code(p_constraint text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_constraint
    when 'products_tenant_id_style_code_key' then 'STYLE_CODE_TAKEN'
    when 'product_variants_tenant_id_sku_key' then 'SKU_TAKEN'
    when 'product_variants_product_id_size_label_colour_label_key' then 'VARIANT_DUPLICATE'
    when 'barcode_aliases_tenant_id_code_key' then 'BARCODE_TAKEN'
    when 'jewellery_items_tenant_id_tag_code_key' then 'TAG_CODE_TAKEN'
    else 'DUPLICATE'
  end;
$$;

create or replace function private.ensure_category(p_tenant uuid, p_name text, p_kind text)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_kind text;
begin
  if length(v_name) < 1 or length(v_name) > 60 then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'category')); end if;
  select id, product_kind into v_id, v_kind from public.categories
   where tenant_id = p_tenant and lower(name) = lower(v_name);
  if v_id is not null then
    if v_kind <> p_kind then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'category')); end if;
    return v_id;
  end if;
  insert into public.categories (tenant_id, name, product_kind) values (p_tenant, v_name, p_kind) returning id into v_id;
  return v_id;
end;
$$;

-- A free barcode/tag for this business: generated, then checked against what already exists.
create or replace function private.generate_code(p_tenant uuid, p_sequence text, p_prefix text, p_width integer)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  v_code text;
  v_try integer := 0;
begin
  loop
    v_code := p_prefix || lpad(private.next_tenant_number(p_tenant, p_sequence)::text, p_width, '0');
    exit when not exists (select 1 from public.barcode_aliases where tenant_id = p_tenant and code = v_code)
          and not exists (select 1 from public.jewellery_items where tenant_id = p_tenant and tag_code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then perform private.fail('INTERNAL'); end if;
  end loop;
  return v_code;
end;
$$;

create or replace function private.clean_code(p_code text, p_field text)
returns text
language plpgsql
immutable set search_path = ''
as $$
declare
  v text := upper(btrim(regexp_replace(coalesce(p_code, ''), '[\x00-\x1f\x7f]', '', 'g')));
begin
  if v !~ '^[A-Z0-9]{4,48}$' then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', p_field)); end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Clothing: one style with its size/colour variants, prices, barcodes and opening stock.
--   p_variants: [{"size":"M","colour":"Blue","pricePaise":129900,"openingStock":5,"sku"?:"..","barcode"?:".."}]
-- ---------------------------------------------------------------------------------------------
create or replace function public.catalog_create_clothing(
  p_branch uuid, p_name text, p_style_code text, p_category text, p_hsn text,
  p_variants jsonb, p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tc text;
  v_date date;
  v_hash text;
  v_replay jsonb;
  v_cat uuid;
  v_product uuid;
  v_v jsonb;
  v_k text;
  v_size text; v_colour text; v_sku text; v_barcode text; v_price bigint; v_stock integer;
  v_variant uuid;
  v_out jsonb := '[]'::jsonb;
  v_any_stock boolean := false;
  v_response jsonb;
  v_constraint text;
begin
  if (select auth.uid()) is null then perform private.fail('UNAUTHENTICATED'); end if;
  select b.tenant_id, upper(t.code), (now() at time zone b.timezone)::date into v_tenant, v_tc, v_date
    from public.branches b join public.tenants t on t.id = b.tenant_id where b.id = p_branch;
  if v_tenant is null then perform private.fail('FORBIDDEN'); end if;
  perform private.assert_any_permission(v_tenant, 'product.create');

  -- ---- validate everything before writing anything ----
  if p_idempotency_key is null or length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or length(btrim(coalesce(p_style_code, ''))) not between 1 and 40
     or (p_hsn is not null and btrim(p_hsn) <> '' and btrim(p_hsn) !~ '^[0-9]{4,8}$')
     or p_variants is null or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) not between 1 and 100 then
    perform private.fail('VALIDATION_ERROR');
  end if;
  for v_v in select * from jsonb_array_elements(p_variants) loop
    if jsonb_typeof(v_v) <> 'object' then perform private.fail('VALIDATION_ERROR'); end if;
    for v_k in select jsonb_object_keys(v_v) loop
      if v_k not in ('size', 'colour', 'sku', 'barcode', 'pricePaise', 'openingStock') then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', v_k)); end if;
    end loop;
    if jsonb_typeof(v_v -> 'pricePaise') <> 'number' or (v_v ->> 'pricePaise') !~ '^[0-9]{1,11}$'
       or (v_v ? 'openingStock' and (jsonb_typeof(v_v -> 'openingStock') <> 'number' or (v_v ->> 'openingStock') !~ '^[0-9]{1,6}$'))
       or length(coalesce(nullif(btrim(v_v ->> 'size'), ''), 'FREE')) > 30
       or length(coalesce(nullif(btrim(v_v ->> 'colour'), ''), 'DEFAULT')) > 30 then
      perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'variant'));
    end if;
    if coalesce((v_v ->> 'openingStock')::integer, 0) > 0 then v_any_stock := true; end if;
  end loop;
  -- the same size and colour twice in one request is a mistake worth naming
  if (select count(*) from jsonb_array_elements(p_variants))
     <> (select count(distinct lower(coalesce(nullif(btrim(e ->> 'size'), ''), 'FREE')) || '|' || lower(coalesce(nullif(btrim(e ->> 'colour'), ''), 'DEFAULT')))
           from jsonb_array_elements(p_variants) e) then
    perform private.fail('VARIANT_DUPLICATE');
  end if;
  if v_any_stock then perform private.assert_branch_permission(p_branch, 'inventory.adjust'); end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object('b', p_branch, 'n', btrim(p_name), 's', btrim(p_style_code),
              'c', btrim(coalesce(p_category, '')), 'h', p_hsn, 'v', p_variants)::text, 'UTF8')), 'hex');
  v_replay := private.idem_begin(v_tenant, 'catalog_create', p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay || jsonb_build_object('replayed', true); end if;

  begin
    v_cat := private.ensure_category(v_tenant, p_category, 'CLOTHING');
    insert into public.products (tenant_id, category_id, style_code, name, hsn_code)
      values (v_tenant, v_cat, btrim(p_style_code), btrim(p_name), nullif(btrim(coalesce(p_hsn, '')), ''))
      returning id into v_product;

    for v_v in select * from jsonb_array_elements(p_variants) loop
      v_size := coalesce(nullif(btrim(v_v ->> 'size'), ''), 'FREE');
      v_colour := coalesce(nullif(btrim(v_v ->> 'colour'), ''), 'DEFAULT');
      v_price := (v_v ->> 'pricePaise')::bigint;
      v_stock := coalesce((v_v ->> 'openingStock')::integer, 0);
      v_sku := coalesce(nullif(btrim(v_v ->> 'sku'), ''),
                 left(trim(both '-' from upper(regexp_replace(btrim(p_style_code) || '-' || v_size || '-' || v_colour, '[^A-Za-z0-9]+', '-', 'g'))), 60));
      v_barcode := case when nullif(btrim(coalesce(v_v ->> 'barcode', '')), '') is not null
                        then private.clean_code(v_v ->> 'barcode', 'barcode')
                        else private.generate_code(v_tenant, 'BARCODE', regexp_replace(v_tc, '[^A-Z0-9]', '', 'g'), 8) end;

      insert into public.product_variants (tenant_id, product_id, sku, size_label, colour_label, selling_price)
        values (v_tenant, v_product, v_sku, v_size, v_colour, v_price / 100.0)
        returning id into v_variant;
      insert into public.barcode_aliases (tenant_id, code, target_type, variant_id, source)
        values (v_tenant, v_barcode, 'VARIANT', v_variant, case when nullif(btrim(coalesce(v_v ->> 'barcode', '')), '') is not null then 'MANUAL' else 'SYSTEM' end);
      if v_stock > 0 then
        perform private.apply_variant_movement(v_tenant, p_branch, v_variant, v_stock, 'OPENING', 'CATALOG', v_product, 'OPENING', null, v_date);
      end if;
      v_out := v_out || jsonb_build_object('variantId', v_variant, 'sku', v_sku, 'barcode', v_barcode, 'size', v_size, 'colour', v_colour);
    end loop;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform private.fail(private.duplicate_code(v_constraint));
  end;

  perform private.write_audit(v_tenant, p_branch, 'catalog.create_clothing', 'product', v_product, null,
            jsonb_build_object('name', btrim(p_name), 'variants', jsonb_array_length(p_variants)), null, null);
  v_response := jsonb_build_object('productId', v_product, 'variants', v_out, 'replayed', false);
  perform private.idem_complete(v_tenant, 'catalog_create', p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Individually tagged jewellery: one physical piece, a unique tag/barcode, a FIXED price.
-- ---------------------------------------------------------------------------------------------
create or replace function public.catalog_create_jewellery(
  p_branch uuid, p_kind text, p_name text, p_category text, p_tag_code text, p_price_paise bigint,
  p_metal text, p_purity text, p_gross_g numeric, p_net_g numeric, p_hsn text, p_barcode text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_date date;
  v_hash text;
  v_replay jsonb;
  v_cat uuid;
  v_design uuid;
  v_design_kind text;
  v_design_code text;
  v_tag text;
  v_barcode text;
  v_item uuid;
  v_response jsonb;
  v_constraint text;
begin
  if (select auth.uid()) is null then perform private.fail('UNAUTHENTICATED'); end if;
  select b.tenant_id, (now() at time zone b.timezone)::date into v_tenant, v_date from public.branches b where b.id = p_branch;
  if v_tenant is null then perform private.fail('FORBIDDEN'); end if;
  perform private.assert_any_permission(v_tenant, 'product.create');
  perform private.assert_branch_permission(p_branch, 'inventory.adjust');   -- adding a piece adds stock

  if p_idempotency_key is null or p_kind not in ('IMITATION', 'PRECIOUS')
     or length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or p_price_paise is null or p_price_paise < 0 or p_price_paise > 100000000000
     or (p_hsn is not null and btrim(p_hsn) <> '' and btrim(p_hsn) !~ '^[0-9]{4,8}$') then
    perform private.fail('VALIDATION_ERROR');
  end if;
  if p_kind = 'PRECIOUS' then
    if length(btrim(coalesce(p_metal, ''))) not between 2 and 20 or length(btrim(coalesce(p_purity, ''))) not between 1 and 12
       or p_gross_g is null or p_net_g is null or p_gross_g <= 0 or p_net_g <= 0 or p_net_g > p_gross_g or p_gross_g > 100000 then
      perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'weights'));
    end if;
  end if;
  if nullif(btrim(coalesce(p_tag_code, '')), '') is not null and upper(btrim(p_tag_code)) !~ '^[A-Z0-9]{4,20}$' then
    perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'tagCode'));
  end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object('b', p_branch, 'k', p_kind, 'n', btrim(p_name), 'c', btrim(coalesce(p_category, '')),
              't', upper(btrim(coalesce(p_tag_code, ''))), 'p', p_price_paise, 'm', p_metal, 'u', p_purity, 'g', p_gross_g, 'w', p_net_g,
              'h', p_hsn, 'x', p_barcode)::text, 'UTF8')), 'hex');
  v_replay := private.idem_begin(v_tenant, 'catalog_create', p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay || jsonb_build_object('replayed', true); end if;

  begin
    v_cat := private.ensure_category(v_tenant, p_category, case p_kind when 'IMITATION' then 'IMITATION_JEWELLERY' else 'PRECIOUS_JEWELLERY' end);
    v_design_code := left(trim(both '-' from upper(regexp_replace(btrim(p_name), '[^A-Za-z0-9]+', '-', 'g'))), 40);
    select id, kind into v_design, v_design_kind from public.jewellery_designs where tenant_id = v_tenant and design_code = v_design_code;
    if v_design is null then
      insert into public.jewellery_designs (tenant_id, kind, category_id, design_code, name, hsn_code)
        values (v_tenant, p_kind, v_cat, v_design_code, btrim(p_name), nullif(btrim(coalesce(p_hsn, '')), ''))
        returning id into v_design;
    elsif v_design_kind <> p_kind then
      perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'name'));
    end if;

    v_tag := case when nullif(btrim(coalesce(p_tag_code, '')), '') is not null then upper(btrim(p_tag_code))
                  else private.generate_code(v_tenant, case p_kind when 'IMITATION' then 'TAG_IMITATION' else 'TAG_PRECIOUS' end,
                                             case p_kind when 'IMITATION' then 'IJ' else 'GJ' end, 7) end;
    v_barcode := case when nullif(btrim(coalesce(p_barcode, '')), '') is not null then private.clean_code(p_barcode, 'barcode') else v_tag end;

    insert into public.jewellery_items (tenant_id, branch_id, design_id, kind, tag_code, status, pricing_mode, tag_price,
                                        metal_type, purity, gross_weight_g, net_weight_g)
      values (v_tenant, p_branch, v_design, p_kind, v_tag, 'IN_STOCK', 'FIXED_TAG', p_price_paise / 100.0,
              case when p_kind = 'PRECIOUS' then upper(btrim(p_metal)) end, case when p_kind = 'PRECIOUS' then upper(btrim(p_purity)) end,
              case when p_kind = 'PRECIOUS' then p_gross_g end, case when p_kind = 'PRECIOUS' then p_net_g end)
      returning id into v_item;
    insert into public.barcode_aliases (tenant_id, code, target_type, jewellery_item_id, source)
      values (v_tenant, v_barcode, 'JEWELLERY_ITEM', v_item, case when nullif(btrim(coalesce(p_barcode, '')), '') is not null then 'MANUAL' else 'SYSTEM' end);
    perform private.apply_item_movement(v_tenant, p_branch, v_item, 1, 'OPENING', 'CATALOG', v_item, v_date);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    perform private.fail(private.duplicate_code(v_constraint));
  end;

  perform private.write_audit(v_tenant, p_branch, 'catalog.create_jewellery', 'jewellery_item', v_item, null,
            jsonb_build_object('tag', v_tag, 'kind', p_kind, 'pricePaise', p_price_paise), null, null);
  v_response := jsonb_build_object('itemId', v_item, 'designId', v_design, 'tagCode', v_tag, 'barcode', v_barcode, 'replayed', false);
  perform private.idem_complete(v_tenant, 'catalog_create', p_idempotency_key, v_response);
  return v_response;
end;
$$;

-- Change a jewellery piece's price or availability. A price change needs product.price_edit; a sold
-- piece's price is locked by a trigger.
create or replace function public.catalog_update_jewellery(p_item uuid, p_price_paise bigint, p_is_active boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_item public.jewellery_items;
begin
  if (select auth.uid()) is null then perform private.fail('UNAUTHENTICATED'); end if;
  select * into v_item from public.jewellery_items where id = p_item;
  if not found then perform private.fail('NOT_FOUND'); end if;
  if private.has_branch_access(v_item.branch_id) is not true then perform private.fail('FORBIDDEN'); end if;
  perform private.assert_any_permission(v_item.tenant_id, 'product.edit');
  if p_price_paise is not null then
    perform private.assert_any_permission(v_item.tenant_id, 'product.price_edit');
    if p_price_paise < 0 or p_price_paise > 100000000000 then perform private.fail('VALIDATION_ERROR'); end if;
  end if;
  update public.jewellery_items
     set tag_price = coalesce(p_price_paise / 100.0, tag_price), is_active = coalesce(p_is_active, is_active)
   where id = p_item;
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function public.catalog_create_clothing(uuid, text, text, text, text, jsonb, uuid),
  public.catalog_create_jewellery(uuid, text, text, text, text, bigint, text, text, numeric, numeric, text, text, uuid),
  public.catalog_update_jewellery(uuid, bigint, boolean) from public, anon;
grant execute on function public.catalog_create_clothing(uuid, text, text, text, text, jsonb, uuid),
  public.catalog_create_jewellery(uuid, text, text, text, text, bigint, text, text, numeric, numeric, text, text, uuid),
  public.catalog_update_jewellery(uuid, bigint, boolean) to authenticated;
