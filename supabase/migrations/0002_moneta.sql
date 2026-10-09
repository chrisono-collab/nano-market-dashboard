-- Moneta Market (micro-market kiosks) sales, synced from the operator portal
-- by /api/cron/moneta-sync and scripts/moneta-backfill.ts, or uploaded from a
-- portal export at /moneta/upload. Run once in the Supabase SQL editor.
-- Writes go through the service-role key, except moneta_product_map, which
-- signed-in dashboard users edit at /moneta/products.

-- One row per distinct product in a cart. cart_key is a hash of machine name,
-- sale time and cart total, so the API sync and portal exports (which carry
-- no transaction id) land on the same rows.
create table if not exists moneta_transactions (
  id bigserial primary key,
  cart_key text not null,
  line_no integer not null,
  transaction_id text,                    -- Moneta cart id (API rows only)
  machine_id text,                        -- Moneta machine GUID when known
  machine_name text not null,
  product_name text not null,
  quantity integer not null,
  line_amount numeric(10, 2) not null,    -- share of cart_total (tax included)
  amount_allocated boolean not null,      -- true when split from a multi-product cart
  cart_total numeric(10, 2) not null,
  cart_unit_cost numeric(10, 2),
  cart_profit numeric(10, 2),
  cart_promotion numeric(10, 2),
  payment_method text,
  sold_at timestamptz not null,
  sale_day date not null,                 -- America/Chicago calendar day
  source text not null check (source in ('api', 'upload')),
  raw jsonb not null,                     -- source row, customer info removed
  synced_at timestamptz not null default now(),
  unique (cart_key, line_no)
);
create index if not exists moneta_tx_day_idx on moneta_transactions (sale_day, machine_name);
create index if not exists moneta_tx_sold_idx on moneta_transactions (sold_at);
create index if not exists moneta_tx_product_idx on moneta_transactions (product_name);

create table if not exists moneta_sync_state (
  id text primary key default 'default',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_cursor date,                       -- last Central day fully covered by a successful sync
  last_error text,
  last_error_at timestamptz,
  last_cart_count integer,
  last_row_count integer,
  total_rows integer,
  warning text,                           -- e.g. zero sales on a day that normally has some
  machines jsonb,                         -- [{id, name}] from the last sync
  updated_at timestamptz not null default now()
);
insert into moneta_sync_state (id) values ('default') on conflict do nothing;

-- Moneta product name -> our sales product name (the name VendSoft/USAT use).
create table if not exists moneta_product_map (
  moneta_name text primary key,
  sku text,                               -- null = seen but not mapped yet
  notes text,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Products sold through Moneta with no mapping yet.
create or replace view moneta_unmapped_products with (security_invoker = true) as
select t.product_name,
       sum(t.quantity)::integer as units,
       sum(t.line_amount) as revenue,
       max(t.sold_at) as last_sold_at,
       array_agg(distinct t.machine_name) as machines
from moneta_transactions t
left join moneta_product_map m on m.moneta_name = t.product_name
where m.sku is null or m.sku = ''
group by t.product_name;

-- Median single-product cart price per product: used to split multi-product
-- cart totals across their lines.
create or replace view moneta_ref_prices with (security_invoker = true) as
select product_name,
       percentile_cont(0.5) within group (order by line_amount / quantity) as unit_price
from moneta_transactions
where not amount_allocated and quantity > 0 and sold_at > now() - interval '180 days'
group by product_name;

-- Atomically replace whole carts (all their lines) and, for API syncs,
-- remove carts in the synced window that Moneta no longer reports (deleted
-- or voided). Uploads never overwrite carts that came from the API.
create or replace function moneta_apply_sync(
  p_rows jsonb,
  p_source text,
  p_prune_from timestamptz default null,
  p_prune_to timestamptz default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  create temp table _incoming on commit drop as
  select * from jsonb_to_recordset(p_rows) as r(
    cart_key text, line_no integer, transaction_id text, machine_id text, machine_name text,
    product_name text, quantity integer, line_amount numeric, amount_allocated boolean,
    cart_total numeric, cart_unit_cost numeric, cart_profit numeric, cart_promotion numeric,
    payment_method text, sold_at timestamptz, sale_day date, raw jsonb);

  if p_source = 'upload' then
    delete from _incoming i where exists (
      select 1 from moneta_transactions t where t.cart_key = i.cart_key and t.source = 'api');
  end if;

  if p_source = 'api' and p_prune_from is not null and p_prune_to is not null then
    delete from moneta_transactions t
    where t.sold_at >= p_prune_from and t.sold_at <= p_prune_to
      and not exists (select 1 from _incoming i where i.cart_key = t.cart_key);
  end if;

  delete from moneta_transactions t where t.cart_key in (select distinct cart_key from _incoming);

  insert into moneta_transactions (
    cart_key, line_no, transaction_id, machine_id, machine_name, product_name, quantity,
    line_amount, amount_allocated, cart_total, cart_unit_cost, cart_profit, cart_promotion,
    payment_method, sold_at, sale_day, source, raw)
  select cart_key, line_no, transaction_id, machine_id, machine_name, product_name, quantity,
         line_amount, amount_allocated, cart_total, cart_unit_cost, cart_profit, cart_promotion,
         payment_method, sold_at, sale_day, p_source, raw
  from _incoming;
  get diagnostics n = row_count;

  -- Register new product names so the mapping page lists them.
  insert into moneta_product_map (moneta_name)
  select distinct product_name from _incoming
  on conflict (moneta_name) do nothing;

  return n;
end $$;
revoke all on function moneta_apply_sync(jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;

alter table moneta_transactions enable row level security;
alter table moneta_sync_state enable row level security;
alter table moneta_product_map enable row level security;

drop policy if exists "signed-in read" on moneta_transactions;
create policy "signed-in read" on moneta_transactions for select to authenticated using (true);
drop policy if exists "signed-in read" on moneta_sync_state;
create policy "signed-in read" on moneta_sync_state for select to authenticated using (true);
drop policy if exists "signed-in read" on moneta_product_map;
create policy "signed-in read" on moneta_product_map for select to authenticated using (true);
drop policy if exists "signed-in write" on moneta_product_map;
create policy "signed-in write" on moneta_product_map for insert to authenticated with check (true);
drop policy if exists "signed-in update" on moneta_product_map;
create policy "signed-in update" on moneta_product_map for update to authenticated using (true) with check (true);
