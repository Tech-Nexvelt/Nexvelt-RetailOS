-- M0008 sales: cash sessions, invoices, immutable line snapshots, payments.
--
-- Invoices, lines and payments are written only by pos_checkout (next migration) and can never be
-- changed afterwards. Deferred constraints make the DATABASE reject an invoice whose lines or
-- payments do not add up, regardless of which code created it.

-- counters need a (tenant, branch, id) key so a session cannot point at another branch's counter
alter table public.counters add constraint counters_tenant_branch_id_key unique (tenant_id, branch_id, id);

create table public.cash_sessions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  branch_id     uuid not null,
  counter_id    uuid not null,
  business_date date not null,
  status        text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  opened_by     uuid not null default auth.uid(),
  opened_at     timestamptz not null default now(),
  opening_float numeric(14, 2) not null check (opening_float >= 0),
  closed_by     uuid,
  closed_at     timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id, counter_id) references public.counters (tenant_id, branch_id, id) on delete restrict
);
create unique index cash_sessions_one_open_per_counter on public.cash_sessions (counter_id) where status = 'OPEN';

create table public.invoices (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null,
  branch_id                 uuid not null,
  counter_id                uuid not null,
  cash_session_id           uuid not null,
  invoice_number            text not null check (length(invoice_number) between 1 and 16),
  financial_year            text not null,
  business_date             date not null,
  issued_at                 timestamptz not null default now(),
  cashier_user_id           uuid not null,
  customer_name             text check (customer_name is null or length(customer_name) <= 120),
  customer_phone            text check (customer_phone is null or customer_phone ~ '^[0-9+ -]{6,20}$'),
  place_of_supply_state_code char(2) not null,
  is_inter_state            boolean not null default false,
  status                    text not null default 'ISSUED' check (status in ('ISSUED', 'VOIDED')),
  voided_at                 timestamptz,
  voided_by                 uuid,
  void_reason               text,
  constraint voided_has_details check (status = 'ISSUED' or (voided_at is not null and voided_by is not null and length(btrim(coalesce(void_reason, ''))) > 0)),
  gross_total               numeric(14, 2) not null check (gross_total >= 0),
  discount_total            numeric(14, 2) not null default 0 check (discount_total >= 0),
  taxable_total             numeric(14, 2) not null check (taxable_total >= 0),
  cgst_total                numeric(14, 2) not null default 0 check (cgst_total >= 0),
  sgst_total                numeric(14, 2) not null default 0 check (sgst_total >= 0),
  igst_total                numeric(14, 2) not null default 0 check (igst_total >= 0),
  tax_total                 numeric(14, 2) not null default 0 check (tax_total >= 0),
  round_off                 numeric(14, 2) not null default 0,
  grand_total               numeric(14, 2) not null check (grand_total > 0),
  paid_total                numeric(14, 2) not null,
  change_total              numeric(14, 2) not null default 0 check (change_total >= 0),
  tax_configured            boolean not null,
  idempotency_key           uuid not null,
  created_at                timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, id, branch_id),
  unique (tenant_id, branch_id, financial_year, invoice_number),
  unique (tenant_id, idempotency_key),
  constraint invoice_tax_adds_up check (tax_total = cgst_total + sgst_total + igst_total),
  constraint invoice_total_adds_up check (grand_total = taxable_total + tax_total + round_off),
  constraint invoice_fully_paid check (paid_total = grand_total),
  foreign key (tenant_id, branch_id, cash_session_id) references public.cash_sessions (tenant_id, branch_id, id) on delete restrict
);
create index invoices_branch_date_idx on public.invoices (tenant_id, branch_id, business_date desc);
create index invoices_session_idx on public.invoices (cash_session_id);

create table public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  branch_id         uuid not null,
  invoice_id        uuid not null,
  line_no           integer not null check (line_no >= 1),
  item_type         text not null check (item_type in ('VARIANT', 'JEWELLERY_ITEM')),
  variant_id        uuid,
  jewellery_item_id uuid,
  product_kind      text not null check (product_kind in ('CLOTHING', 'IMITATION_JEWELLERY', 'PRECIOUS_JEWELLERY')),
  description       text not null,
  code_snapshot     text not null,
  hsn_code          text,
  quantity          integer not null check (quantity >= 1),
  unit_price        numeric(14, 2) not null check (unit_price >= 0),
  pricing_mode      text not null check (pricing_mode in ('VARIANT_PRICE', 'FIXED_TAG', 'METAL_RATE')),
  price_includes_tax boolean,
  gross_amount      numeric(14, 2) not null check (gross_amount >= 0),
  discount_amount   numeric(14, 2) not null default 0 check (discount_amount >= 0),
  discount_reason   text,
  taxable_value     numeric(14, 2) not null check (taxable_value >= 0),
  tax_class_id      uuid,
  gst_rate_pct      numeric(7, 4),
  cgst_amount       numeric(14, 2) not null default 0 check (cgst_amount >= 0),
  sgst_amount       numeric(14, 2) not null default 0 check (sgst_amount >= 0),
  igst_amount       numeric(14, 2) not null default 0 check (igst_amount >= 0),
  line_total        numeric(14, 2) not null check (line_total >= 0),
  line_status       text not null default 'SOLD' check (line_status in ('SOLD', 'RETURNED', 'VOIDED')),
  unique (invoice_id, line_no),
  unique (tenant_id, id),
  check (num_nonnulls(variant_id, jewellery_item_id) = 1),
  check ((item_type = 'VARIANT') = (variant_id is not null)),
  check (item_type = 'VARIANT' or quantity = 1),
  check (discount_amount <= gross_amount),
  check (discount_amount = 0 or length(btrim(coalesce(discount_reason, ''))) > 0),
  check (line_total = taxable_value + cgst_amount + sgst_amount + igst_amount),
  foreign key (tenant_id, invoice_id, branch_id) references public.invoices (tenant_id, id, branch_id) on delete restrict,
  foreign key (tenant_id, variant_id) references public.product_variants (tenant_id, id) on delete restrict,
  foreign key (tenant_id, jewellery_item_id) references public.jewellery_items (tenant_id, id) on delete restrict,
  foreign key (tenant_id, tax_class_id) references public.tax_classes (tenant_id, id) on delete restrict
);
-- Second, independent guard against selling one physical piece twice: at most one live sale line.
create unique index invoice_items_one_live_sale_per_piece on public.invoice_items (jewellery_item_id)
  where jewellery_item_id is not null and line_status = 'SOLD';
create index invoice_items_invoice_idx on public.invoice_items (tenant_id, invoice_id);
create index invoice_items_variant_idx on public.invoice_items (tenant_id, variant_id);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  branch_id       uuid not null,
  cash_session_id uuid not null,
  invoice_id      uuid not null,
  direction       text not null default 'IN' check (direction in ('IN', 'OUT')),
  purpose         text not null default 'SALE' check (purpose in ('SALE', 'VOID_REVERSAL', 'REFUND')),
  reverses_payment_id uuid,
  method          text not null check (method in ('CASH', 'UPI', 'CARD')),
  amount          numeric(14, 2) not null check (amount > 0),
  tendered_amount numeric(14, 2),
  change_amount   numeric(14, 2),
  reference_no    text check (reference_no is null or length(reference_no) <= 64),
  recorded_by     uuid not null default auth.uid(),
  recorded_at     timestamptz not null default now(),
  check (method = 'CASH' or (tendered_amount is null and change_amount is null)),
  check (method <> 'CASH' or direction = 'OUT' or (tendered_amount >= amount and change_amount = tendered_amount - amount)),
  check ((direction = 'IN') = (purpose = 'SALE')),
  foreign key (tenant_id, invoice_id, branch_id) references public.invoices (tenant_id, id, branch_id) on delete restrict,
  foreign key (tenant_id, branch_id, cash_session_id) references public.cash_sessions (tenant_id, branch_id, id) on delete restrict
);
create index payments_invoice_idx on public.payments (tenant_id, invoice_id);
create index payments_session_idx on public.payments (cash_session_id);

-- Invoices, lines and payments never change after they are written, with ONE exception: a void.
-- An invoice may move ISSUED -> VOIDED (recording who, when and why) and its lines SOLD -> VOIDED.
-- Every other column is frozen, and nothing can be deleted.
create or replace function private.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_skip text[] := array['status', 'voided_at', 'voided_by', 'void_reason'];
begin
  if tg_op = 'UPDATE'
     and old.status = 'ISSUED' and new.status = 'VOIDED'
     and (to_jsonb(new) - v_skip) = (to_jsonb(old) - v_skip) then
    return new;
  end if;
  raise exception 'invoices is append-only (only a void is allowed)' using errcode = '42501';
end;
$$;
create or replace function private.invoice_items_guard()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.line_status = 'SOLD' and new.line_status = 'VOIDED'
     and (to_jsonb(new) - 'line_status') = (to_jsonb(old) - 'line_status')
     and exists (select 1 from public.invoices i where i.id = new.invoice_id and i.status = 'VOIDED') then
    return new;
  end if;
  raise exception 'invoice_items is append-only (only a void is allowed)' using errcode = '42501';
end;
$$;
create trigger invoices_immutable before update or delete on public.invoices
  for each row execute function private.invoices_guard();
create trigger invoice_items_immutable before update or delete on public.invoice_items
  for each row execute function private.invoice_items_guard();
create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.ledger_immutable();
create trigger invoices_no_truncate before truncate on public.invoices
  for each statement execute function private.ledger_immutable();
create trigger invoice_items_no_truncate before truncate on public.invoice_items
  for each statement execute function private.ledger_immutable();
create trigger payments_no_truncate before truncate on public.payments
  for each statement execute function private.ledger_immutable();

-- At COMMIT the invoice must reconcile with its lines and payments, or the whole transaction fails.
create or replace function private.invoice_reconciles()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_lines record;
  v_paid numeric(14, 2);
begin
  select coalesce(sum(line_total), 0) as total, coalesce(sum(gross_amount), 0) as gross,
         coalesce(sum(discount_amount), 0) as disc, coalesce(sum(taxable_value), 0) as taxable,
         coalesce(sum(cgst_amount), 0) as cgst, coalesce(sum(sgst_amount), 0) as sgst, count(*) as n
    into v_lines from public.invoice_items where invoice_id = new.id;
  if v_lines.n = 0 then raise exception 'invoice % has no lines', new.id using errcode = '23514'; end if;
  if v_lines.total + new.round_off <> new.grand_total
     or v_lines.gross <> new.gross_total or v_lines.disc <> new.discount_total
     or v_lines.taxable <> new.taxable_total or v_lines.cgst <> new.cgst_total or v_lines.sgst <> new.sgst_total then
    raise exception 'invoice % does not reconcile with its lines', new.id using errcode = '23514';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = new.id and direction = 'IN';
  if v_paid <> new.grand_total then
    raise exception 'invoice % payments (%) do not equal the total (%)', new.id, v_paid, new.grand_total using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger invoices_reconcile after insert on public.invoices
  deferrable initially deferred for each row execute function private.invoice_reconciles();

create trigger invoices_audit after insert on public.invoices
  for each row execute function private.audit_row_change('invoice');

-- ---------------------------------------------------------------------------------------------
-- Privileges and RLS: read-only for the API; writes only via pos_checkout.
-- ---------------------------------------------------------------------------------------------
grant select on public.cash_sessions, public.invoices, public.invoice_items, public.payments to authenticated;

alter table public.cash_sessions enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments      enable row level security;

create policy cash_sessions_read on public.cash_sessions for select to authenticated
  using (private.has_branch_permission(branch_id, 'cash_session.manage') or private.has_branch_permission(branch_id, 'sale.view'));

-- Invoice visibility: sale.view_history sees every invoice of the branch; sale.view only today's.
-- A cashier has neither by default (the owner can add "Sales" as an exception).
create policy invoices_read on public.invoices for select to authenticated
  using (
    private.has_branch_permission(branch_id, 'sale.view_history')
    or (private.has_branch_permission(branch_id, 'sale.view') and business_date = private.branch_today(branch_id))
  );
-- Lines and payments follow the invoice: if the invoice is not visible to the caller, neither are they.
create policy invoice_items_read on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.tenant_id = invoice_items.tenant_id and i.id = invoice_items.invoice_id));
create policy payments_read on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i where i.tenant_id = payments.tenant_id and i.id = payments.invoice_id));

-- Line-level cost for margin reports would live in a separate cost-gated table (later).
