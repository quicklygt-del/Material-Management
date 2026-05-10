-- 倉儲總帳：一物多儲位 + 異動軌跡擴充（單一公司、無租戶欄位）
-- 於 Supabase SQL Editor 執行；可重複執行。

create table if not exists public.warehouse_ledger_bin_stock (
  id uuid primary key default gen_random_uuid(),
  item_no text not null,
  bin_code text not null,
  qty integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint warehouse_ledger_bin_stock_qty_check check (
    qty >= -2147483648 and qty <= 2147483647
  ),
  constraint warehouse_ledger_bin_stock_item_bin_unique unique (item_no, bin_code)
);

create index if not exists idx_warehouse_ledger_bin_stock_item
  on public.warehouse_ledger_bin_stock (item_no);
create index if not exists idx_warehouse_ledger_bin_stock_bin_ci
  on public.warehouse_ledger_bin_stock (lower(bin_code));

comment on table public.warehouse_ledger_bin_stock is '料號×儲位 明細量；總帳主檔 on_hand/stock_quantity 應與各儲位加總一致';

alter table public.warehouse_ledger_bin_stock enable row level security;
drop policy if exists warehouse_ledger_bin_stock_all on public.warehouse_ledger_bin_stock;
create policy warehouse_ledger_bin_stock_all on public.warehouse_ledger_bin_stock
  for all using (true) with check (true);
grant select, insert, update, delete on public.warehouse_ledger_bin_stock to anon, authenticated;
grant select, insert, update, delete on public.warehouse_ledger_bin_stock to service_role;

alter table public.warehouse_ledger_lines
  add column if not exists tx_type text;
alter table public.warehouse_ledger_lines
  add column if not exists from_bin text;
alter table public.warehouse_ledger_lines
  add column if not exists to_bin text;
alter table public.warehouse_ledger_lines
  add column if not exists operator_name text;
alter table public.warehouse_ledger_lines
  add column if not exists bin_balance_after integer;

update public.warehouse_ledger_lines
set tx_type = case
  when direction = 'outbound' then 'legacy_outbound'
  else 'legacy_inbound'
end
where tx_type is null;

alter table public.warehouse_ledger_lines
  alter column tx_type set default 'inbound';
alter table public.warehouse_ledger_lines
  alter column tx_type set not null;

alter table public.warehouse_ledger_lines
  drop constraint if exists warehouse_ledger_lines_tx_type_check;
alter table public.warehouse_ledger_lines
  add constraint warehouse_ledger_lines_tx_type_check check (
    tx_type in (
      'inbound',
      'outbound',
      'transfer',
      'stocktake',
      'special_issue',
      'legacy_inbound',
      'legacy_outbound'
    )
  );
