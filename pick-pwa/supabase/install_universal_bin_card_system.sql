-- =============================================================================
-- 數位物料卡｜單位萬用帳本 — 完整安裝（Supabase SQL Editor 一次貼上執行）
--
-- 唯一前置：public.label_records 必須已存在（標籤中心／API 寫入用）
-- 本腳本會自動建立 public.storage_zones（管理單位／分頁）及相關表
-- =============================================================================

-- =============================================================================
-- 0) 管理單位（原「虛擬倉」）— API /warehouses 使用此表
create table if not exists public.storage_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_storage_zones_tenant on public.storage_zones (tenant_id);

comment on table public.storage_zones is '虛擬倉／管理區；每租戶最多 5 筆（由應用程式限制）';

alter table public.storage_zones enable row level security;
drop policy if exists storage_zones_all on public.storage_zones;
drop policy if exists warehouses_all on public.storage_zones;
create policy storage_zones_all on public.storage_zones for all using (true) with check (true);

grant select, insert, update, delete on public.storage_zones to anon, authenticated;
grant select, insert, update, delete on public.storage_zones to service_role;

-- 與舊版 schema_warehouse 對齊之 label_records 欄位（若表已存在則安全略過）
alter table public.label_records
  add column if not exists warehouse_id uuid references public.storage_zones (id) on delete set null;
alter table public.label_records
  add column if not exists manageable_asset boolean not null default true;

-- =============================================================================
-- 1) 物料主軸異動
create table if not exists public.material_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  material_item_no text not null,
  label_record_id uuid references public.label_records (id) on delete set null,
  action_type text not null check (action_type in ('inbound', 'pick', 'stocktake')),
  quantity_delta integer not null,
  operator_name text not null default '現場',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_material_tx_tenant_item
  on public.material_transactions (tenant_id, material_item_no);
create index if not exists idx_material_tx_label
  on public.material_transactions (label_record_id);

alter table public.material_transactions enable row level security;
drop policy if exists material_transactions_all on public.material_transactions;
create policy material_transactions_all on public.material_transactions for all using (true) with check (true);
grant select, insert, update, delete on public.material_transactions to anon, authenticated;
grant select, insert, update, delete on public.material_transactions to service_role;

-- =============================================================================
-- 2) 單位萬用帳本主表（含物料卡欄位 summary / balance_after）
create table if not exists public.universal_ledger_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  unit_id uuid not null references public.storage_zones (id) on delete cascade,
  label_record_id uuid references public.label_records (id) on delete set null,
  qr_payload text not null,
  action_type text not null check (action_type in ('inbound', 'pick', 'stocktake')),
  quantity_delta integer not null,
  operator_name text not null default '現場',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  summary text,
  balance_after integer not null default 0
);

alter table public.universal_ledger_records
  add column if not exists summary text;
alter table public.universal_ledger_records
  add column if not exists balance_after integer not null default 0;

comment on column public.universal_ledger_records.summary is '物料卡摘要（通常為標籤內容說明）';
comment on column public.universal_ledger_records.balance_after is '本筆異動後該標籤於此單位之結餘';

create index if not exists idx_universal_ledger_tenant_unit
  on public.universal_ledger_records (tenant_id, unit_id);
create index if not exists idx_universal_ledger_label_unit
  on public.universal_ledger_records (label_record_id, unit_id);

comment on table public.universal_ledger_records is '單位萬用帳本：入庫／領用／盤點（綁定管理單位分頁）';

alter table public.universal_ledger_records enable row level security;
drop policy if exists universal_ledger_records_all on public.universal_ledger_records;
create policy universal_ledger_records_all on public.universal_ledger_records for all using (true) with check (true);
grant select, insert, update, delete on public.universal_ledger_records to anon, authenticated;
grant select, insert, update, delete on public.universal_ledger_records to service_role;

-- =============================================================================
-- 3) 既有資料：重算結餘
update public.universal_ledger_records AS u
SET balance_after = s.bal::integer
FROM (
  SELECT id,
    SUM(quantity_delta) OVER (
      PARTITION BY tenant_id, unit_id, COALESCE(label_record_id::text, qr_payload)
      ORDER BY created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS bal
  FROM public.universal_ledger_records
) AS s
WHERE u.id = s.id;

-- =============================================================================
-- 4) label_records.label_type：確保含 D（單位萬用）／UNIVERSAL（可選同義）
--    若僅有舊版 S/R/B/Q 約束，單位萬用標籤寫入會失敗
-- =============================================================================
alter table public.label_records
  drop constraint if exists label_records_label_type_check;

alter table public.label_records
  add constraint label_records_label_type_check
  check (label_type in ('S', 'R', 'B', 'Q', 'D', 'UNIVERSAL'));

-- =============================================================================
-- 5) 刪除 storage_zones（管理單位）時 CASCADE 清除 universal_ledger_records
-- =============================================================================
alter table public.universal_ledger_records
  drop constraint if exists universal_ledger_records_unit_id_fkey;

alter table public.universal_ledger_records
  add constraint universal_ledger_records_unit_id_fkey
  foreign key (unit_id) references public.storage_zones (id) on delete cascade;
