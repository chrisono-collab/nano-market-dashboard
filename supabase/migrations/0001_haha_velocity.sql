-- HaHa velocity integration: sales history (USAT backfill + daily VendSoft
-- snapshots) and HaHa restock events. Run once in Supabase SQL editor.
-- Writes happen only via the service-role key (bypasses RLS); signed-in
-- dashboard users get read access.

create table if not exists sales_line_items (
  id bigserial primary key,
  source text not null check (source in ('usat', 'vendsoft')),
  market_id text not null,          -- HaHa marketId, resolved at load time
  machine_label text not null,      -- USAT "Machine" or VendSoft machineCode, for audit
  product_name text not null,       -- identical naming in USAT and VendSoft
  quantity numeric not null,
  price numeric,
  sold_at timestamptz not null,
  sale_day date not null            -- America/Chicago calendar day
);
create index if not exists sales_market_sold_idx on sales_line_items (market_id, sold_at);
create index if not exists sales_source_day_idx on sales_line_items (source, sale_day);

create table if not exists restock_events (
  market_id text not null,
  product_id text not null,
  product_name text,
  occurred_at timestamptz not null,
  restock_op_log_id text not null,
  change_num numeric,
  after_num numeric,
  primary key (market_id, product_id, restock_op_log_id)
);
create index if not exists restock_market_idx on restock_events (market_id, occurred_at);

create table if not exists restock_scan_state (
  market_id text primary key,
  last_scanned_created_at timestamptz,
  last_scanned_restock_op_log_id text,
  last_scanned_at timestamptz not null default now(),
  records_scanned integer not null default 0
);

alter table sales_line_items enable row level security;
alter table restock_events enable row level security;
alter table restock_scan_state enable row level security;

drop policy if exists "signed-in read" on sales_line_items;
create policy "signed-in read" on sales_line_items for select to authenticated using (true);
drop policy if exists "signed-in read" on restock_events;
create policy "signed-in read" on restock_events for select to authenticated using (true);
drop policy if exists "signed-in read" on restock_scan_state;
create policy "signed-in read" on restock_scan_state for select to authenticated using (true);
