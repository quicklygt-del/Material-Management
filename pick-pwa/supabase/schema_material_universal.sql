-- 物料主軸異動（與 label_records / 料號對齊；QR 內容即為料號時以 material_item_no 彙總）
create table if not exists public.material_transactions (
  id uuid primary key default gen_random_uuid(),
   text not null,
  material_item_no text not null,
  label_record_id uuid references public.label_records (id) on delete set null,
  action_type text not null check (action_type in ('inbound', 'pick', 'stocktake')),
  quantity_delta integer not null,
  operator_name text not null default '現場',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_tx__item
  on public.material_transactions (, material_item_no);
create index if not exists idx_material_tx_label
  on public.material_transactions (label_record_id);

comment on table public.material_transactions is '物料主軸：入庫／領用／盤點（料號即 UID）';

alter table public.material_transactions enable row level security;
drop policy if exists material_transactions_all on public.material_transactions;
create policy material_transactions_all on public.material_transactions for all using (true) with check (true);
grant select, insert, update, delete on public.material_transactions to anon, authenticated;
grant select, insert, update, delete on public.material_transactions to service_role;

-- 單位萬用帳本異動（必須關聯 storage_zones 分頁）
create table if not exists public.universal_ledger_records (
  id uuid primary key default gen_random_uuid(),
   text not null,
  unit_id uuid not null references public.storage_zones (id) on delete cascade,
  label_record_id uuid references public.label_records (id) on delete set null,
  qr_payload text not null,
  action_type text not null check (action_type in ('inbound', 'pick', 'stocktake')),
  quantity_delta integer not null,
  operator_name text not null default '現場',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_universal_ledger__unit
  on public.universal_ledger_records (, unit_id);
create index if not exists idx_universal_ledger_label_unit
  on public.universal_ledger_records (label_record_id, unit_id);

comment on table public.universal_ledger_records is '單位萬用帳本：入庫／領用／盤點（綁定管理單位分頁）';

alter table public.universal_ledger_records
  add column if not exists summary text;
alter table public.universal_ledger_records
  add column if not exists balance_after integer not null default 0;

alter table public.universal_ledger_records enable row level security;
drop policy if exists universal_ledger_records_all on public.universal_ledger_records;
create policy universal_ledger_records_all on public.universal_ledger_records for all using (true) with check (true);
grant select, insert, update, delete on public.universal_ledger_records to anon, authenticated;
grant select, insert, update, delete on public.universal_ledger_records to service_role;
