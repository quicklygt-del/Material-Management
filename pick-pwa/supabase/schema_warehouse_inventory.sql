-- 虛擬多倉（storage_zones）+ 庫存異動（與 label_records 關聯）
-- 執行前請已存在 public.label_records
-- 若舊庫仍為 public.warehouses，請先執行 migrate_warehouses_to_storage_zones.sql

create table if not exists public.storage_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_storage_zones_tenant on public.storage_zones (tenant_id);

comment on table public.storage_zones is '虛擬倉／管理區；每租戶最多 5 筆（由應用程式限制）';

alter table public.label_records
  add column if not exists warehouse_id uuid references public.storage_zones (id) on delete set null;

alter table public.label_records
  add column if not exists manageable_asset boolean not null default true;

comment on column public.label_records.warehouse_id is '預設歸屬倉（可空）';
comment on column public.label_records.manageable_asset is '是否為可執行入庫/領用/盤點之資產';

create table if not exists public.inventory_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  label_record_id uuid references public.label_records (id) on delete set null,
  qr_payload text not null,
  warehouse_id uuid not null references public.storage_zones (id) on delete restrict,
  operator_name text not null,
  quantity_delta int not null,
  action_type text not null check (action_type in ('inbound', 'pick', 'stocktake')),
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_inventory_logs_tenant_created
  on public.inventory_logs (tenant_id, created_at desc);
create index if not exists idx_inventory_logs_label
  on public.inventory_logs (label_record_id);

comment on table public.inventory_logs is '庫存異動：入庫/領用/盤點';
comment on column public.inventory_logs.quantity_delta is '入庫為正、領用為負、盤點可為帳差';

alter table public.storage_zones enable row level security;
alter table public.inventory_logs enable row level security;

drop policy if exists storage_zones_all on public.storage_zones;
create policy storage_zones_all on public.storage_zones for all using (true) with check (true);
drop policy if exists warehouses_all on public.storage_zones;
drop policy if exists inventory_logs_all on public.inventory_logs;
create policy inventory_logs_all on public.inventory_logs for all using (true) with check (true);

grant select, insert, update, delete on public.storage_zones to anon, authenticated;
grant select, insert, update, delete on public.inventory_logs to anon, authenticated;
