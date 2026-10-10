-- ROLLBACK for supabase/retailos/migrations (0001-0014). NOT APPLIED. Requires separate approval.
-- Drops ONLY objects created by those migrations, each by exact name. Never drops schema retailos,
-- never touches schema public, auth, or the 10 live retailos_* tables. Run as the same role that applied the migrations (postgres).
-- LIMITS: it cannot restore anything those migrations did not create; data written into the dropped tables is lost;
-- rows that the bootstrap script added are lost with their tables. Auth users are NOT removed.

begin;

drop function if exists retailos.branch_membership_set_status(uuid,uuid,text);
drop function if exists retailos.catalog_create_clothing(uuid,text,text,text,text,jsonb,uuid);
drop function if exists retailos.catalog_create_jewellery(uuid,text,text,text,text,bigint,text,text,numeric,numeric,text,text,uuid);
drop function if exists retailos.catalog_search(uuid,text);
drop function if exists retailos.catalog_update_jewellery(uuid,bigint,boolean);
drop function if exists retailos.discount_limit_set(uuid,text,integer);
drop function if exists retailos.inventory_adjust(uuid,uuid,integer,text,text,uuid);
drop function if exists retailos.membership_grant(uuid,uuid,text,jsonb);
drop function if exists retailos.membership_set_status(uuid,uuid,text);
drop function if exists retailos.metal_rate_set(uuid,text,text,numeric,text,timestamp with time zone,text,uuid);
drop function if exists retailos.permission_override_clear(uuid,uuid,uuid,text);
drop function if exists retailos.permission_override_set(uuid,uuid,uuid,text,text,text,timestamp with time zone);
drop function if exists retailos.platform_create_tenant(text,text,text,uuid);
drop function if exists retailos.pos_checkout(uuid,uuid,uuid,jsonb,jsonb,bigint,jsonb);
drop function if exists retailos.pos_get_session(uuid,uuid);
drop function if exists retailos.pos_quote_cart(uuid,jsonb);
drop function if exists retailos.pos_start_day(uuid,uuid,bigint);
drop function if exists retailos.pos_void_invoice(uuid,text,uuid);
drop function if exists retailos.report_sales_export(uuid,date,date);
drop function if exists retailos.report_sales_summary(uuid,date,date);
drop function if exists retailos.report_tenant_sales(uuid,date,date);
drop function if exists retailos.resolve_barcode(uuid,text);

drop table if exists retailos.audit_logs cascade;
drop table if exists retailos.barcode_aliases cascade;
drop table if exists retailos.branch_memberships cascade;
drop table if exists retailos.branches cascade;
drop table if exists retailos.brands cascade;
drop table if exists retailos.cash_sessions cascade;
drop table if exists retailos.categories cascade;
drop table if exists retailos.counters cascade;
drop table if exists retailos.document_sequences cascade;
drop table if exists retailos.idempotency_keys cascade;
drop table if exists retailos.inventory_balances cascade;
drop table if exists retailos.inventory_movements cascade;
drop table if exists retailos.invoice_items cascade;
drop table if exists retailos.invoices cascade;
drop table if exists retailos.jewellery_designs cascade;
drop table if exists retailos.jewellery_item_costs cascade;
drop table if exists retailos.jewellery_items cascade;
drop table if exists retailos.metal_rates cascade;
drop table if exists retailos.payments cascade;
drop table if exists retailos.permission_overrides cascade;
drop table if exists retailos.permissions cascade;
drop table if exists retailos.platform_admins cascade;
drop table if exists retailos.product_variants cascade;
drop table if exists retailos.products cascade;
drop table if exists retailos.profiles cascade;
drop table if exists retailos.role_discount_limits cascade;
drop table if exists retailos.role_permissions cascade;
drop table if exists retailos.roles cascade;
drop table if exists retailos.tax_classes cascade;
drop table if exists retailos.tax_rates cascade;
drop table if exists retailos.tenant_memberships cascade;
drop table if exists retailos.tenant_sequences cascade;
drop table if exists retailos.tenant_settings cascade;
drop table if exists retailos.tenants cascade;
drop table if exists retailos.variant_costs cascade;

drop schema if exists retailos_private cascade;

-- restore the schema-level state that existed before: default privilege and schema USAGE
revoke usage on schema retailos from service_role;
alter default privileges in schema retailos grant select on tables to authenticated;

commit;
