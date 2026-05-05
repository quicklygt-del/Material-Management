-- 倉儲總帳（料號總量＋異動日誌）— 與標籤前綴／tenant_id 對齊
-- 請於 Supabase SQL Editor 與現有環境合併執行

create table if not exists public.warehouse_ledger_stock (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  item_no text not null,
  item_name text not null default '',
  spec text not null default '',
  on_hand integer not null default 0,
  /** 預留 ERP 額外欄位對應，不改表亦可擴充 */
  attrs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_ledger_stock_on_hand_finite check (
    on_hand >= -2147483648 and on_hand <= 2147483647
  ),
  constraint warehouse_ledger_stock_tenant_item_unique unique (tenant_id, item_no)
);

comment on table public.warehouse_ledger_stock is '倉儲總帳主檔：現有總量（ERP 對帳基底）';

create index if not exists idx_warehouse_ledger_stock_tenant
  on public.warehouse_ledger_stock (tenant_id);

create index if not exists idx_warehouse_ledger_stock_item_no_ci
  on public.warehouse_ledger_stock (tenant_id, lower(item_no));

create table if not exists public.warehouse_ledger_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  item_no text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  /** 變動量（正值；语义由 direction 決定出入） */
  qty_delta integer not null check (qty_delta > 0),
  balance_after integer not null,
  shortage_forced boolean not null default false,
  /** 備註：order_no / task_id / operator / ERP 對應等 */
  ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.warehouse_ledger_lines is '倉儲總帳異動日誌';

create index if not exists idx_warehouse_ledger_lines_tenant_item
  on public.warehouse_ledger_lines (tenant_id, item_no);
create index if not exists idx_warehouse_ledger_lines_created
  on public.warehouse_ledger_lines (tenant_id, created_at desc);

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
