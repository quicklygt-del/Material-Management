-- 倉儲總帳（料號總量＋異動日誌）— 單一公司架構，以 item_no 為料號主鍵
-- 請於 Supabase SQL Editor 與現有環境合併執行

create table if not exists public.warehouse_ledger_stock (
  id uuid primary key default gen_random_uuid(),
  item_no text not null,
  item_name text not null default '',
  spec text not null default '',
  on_hand integer not null default 0,
  attrs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_ledger_stock_on_hand_finite check (
    on_hand >= -2147483648 and on_hand <= 2147483647
  ),
  constraint warehouse_ledger_stock__item_unique unique (item_no)
);

comment on table public.warehouse_ledger_stock is '倉儲總帳主檔：現有總量（ERP 對帳基底）';

create index if not exists idx_warehouse_ledger_stock_item_no_ci
  on public.warehouse_ledger_stock (lower(item_no));

create table if not exists public.warehouse_ledger_lines (
  id uuid primary key default gen_random_uuid(),
  item_no text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  qty_delta integer not null check (qty_delta > 0),
  balance_after integer not null,
  shortage_forced boolean not null default false,
  ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.warehouse_ledger_lines is '倉儲總帳異動日誌';

create index if not exists idx_warehouse_ledger_lines__item
  on public.warehouse_ledger_lines (item_no);
create index if not exists idx_warehouse_ledger_lines_created
  on public.warehouse_ledger_lines (created_at desc);

alter table public.warehouse_ledger_stock enable row level security;
drop policy if exists warehouse_ledger_stock_all on public.warehouse_ledger_stock;
create policy warehouse_ledger_stock_all on public.warehouse_ledger_stock
  for all using (true) with check (true);
grant select, insert, update, delete on public.warehouse_ledger_stock to anon, authenticated;
grant select, insert, update, delete on public.warehouse_ledger_stock to service_role;

alter table public.warehouse_ledger_lines enable row level security;
drop policy if exists warehouse_ledger_lines_all on public.warehouse_ledger_lines;
create policy warehouse_ledger_lines_all on public.warehouse_ledger_lines
  for all using (true) with check (true);
grant select, insert, update, delete on public.warehouse_ledger_lines to anon, authenticated;
grant select, insert, update, delete on public.warehouse_ledger_lines to service_role;
