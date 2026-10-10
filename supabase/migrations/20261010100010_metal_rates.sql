-- M0010 metal rates: an immutable, effective-dated history set only by people with metal_rate.set.
--
-- This stores rates. It does NOT price anything yet: jewellery pricing rules are an open client
-- decision (OQ-01, 02, 05, 08) and the checkout still refuses METAL_RATE items with
-- RULE_NOT_CONFIGURED. Nothing here fixes a rate, a unit convention or a formula.

create table public.metal_rates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  metal_type     text not null check (metal_type ~ '^[A-Z0-9_ ]{2,20}$'),
  purity         text not null check (purity ~ '^[A-Z0-9_.]{1,12}$'),
  entered_rate   numeric(14, 4) not null check (entered_rate > 0),
  entered_unit   text not null check (entered_unit in ('PER_GRAM', 'PER_10_GRAM')),
  rate_per_gram  numeric(14, 4) not null check (rate_per_gram > 0),
  effective_from timestamptz not null,
  source         text not null default '' check (length(source) <= 200),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, metal_type, purity, effective_from)
);
create index metal_rates_lookup_idx on public.metal_rates (tenant_id, metal_type, purity, effective_from desc);

-- A rate is history. It is never edited or deleted; a correction is a new row.
create trigger metal_rates_immutable before update or delete on public.metal_rates
  for each row execute function private.ledger_immutable();
create trigger metal_rates_no_truncate before truncate on public.metal_rates
  for each statement execute function private.ledger_immutable();
create trigger metal_rates_audit after insert on public.metal_rates
  for each row execute function private.audit_row_change('metal_rate');

create or replace function public.metal_rate_set(
  p_tenant uuid, p_metal_type text, p_purity text, p_rate numeric, p_unit text,
  p_effective_from timestamptz, p_source text, p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_hash text;
  v_replay jsonb;
  v_per_gram numeric;
  v_id uuid;
  v_response jsonb;
begin
  perform private.assert_tenant_permission(p_tenant, 'metal_rate.set');
  if p_idempotency_key is null or p_rate is null or p_rate <= 0 or p_effective_from is null
     or p_unit not in ('PER_GRAM', 'PER_10_GRAM') then
    perform private.fail('VALIDATION_ERROR');
  end if;
  if p_effective_from > now() + interval '1 day' then perform private.fail('VALIDATION_ERROR', jsonb_build_object('field', 'effectiveFrom')); end if;

  v_hash := encode(sha256(convert_to(jsonb_build_object('t', p_tenant, 'm', upper(btrim(p_metal_type)), 'p', upper(btrim(p_purity)),
              'r', p_rate, 'u', p_unit, 'e', p_effective_from, 's', coalesce(p_source, ''))::text, 'UTF8')), 'hex');
  v_replay := private.idem_begin(p_tenant, 'metal_rate_set', p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay || jsonb_build_object('replayed', true); end if;

  v_per_gram := case p_unit when 'PER_10_GRAM' then p_rate / 10 else p_rate end;
  insert into public.metal_rates (tenant_id, metal_type, purity, entered_rate, entered_unit, rate_per_gram,
                                  effective_from, source, created_by)
    values (p_tenant, upper(btrim(p_metal_type)), upper(btrim(p_purity)), p_rate, p_unit, v_per_gram,
            p_effective_from, coalesce(p_source, ''), (select auth.uid()))
    returning id into v_id;

  v_response := jsonb_build_object('rateId', v_id, 'ratePerGram', v_per_gram, 'replayed', false);
  perform private.idem_complete(p_tenant, 'metal_rate_set', p_idempotency_key, v_response);
  return v_response;
end;
$$;

grant select on public.metal_rates to authenticated;
alter table public.metal_rates enable row level security;
create policy metal_rates_read on public.metal_rates for select to authenticated
  using (private.has_any_permission(tenant_id, 'metal_rate.view'));

revoke execute on all functions in schema private from public, anon;
revoke execute on function public.metal_rate_set(uuid, text, text, numeric, text, timestamptz, text, uuid) from public, anon;
grant execute on function public.metal_rate_set(uuid, text, text, numeric, text, timestamptz, text, uuid) to authenticated;
