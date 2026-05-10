-- WMS：與程式欄位名稱一致（若你已手動建表可略過 CREATE，僅執行缺漏的 ALTER／索引／RLS）。
-- 執行前請檢閱並與你現有 DDL 對齊。
-- 現場 QR 內容即料號 item_no，與 picking_tasks 比對；應用程式不依賴 nfc_master。（舊庫可自行 drop table public.nfc_master。）

create extension if not exists "pgcrypto";

-- 派單明細（一筆 = 某單需撿某一料號）
create table if not exists public.picking_tasks (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  item_no text not null,
  required_qty int not null check (required_qty > 0),
-- 程式已改用 picking_logs.actual_qty 彙總；若資料庫仍保留下列欄位可視需要刪除：
-- picked_qty int not null default 0 check (picked_qty >= 0),
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  assigned_operator text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.picking_tasks add column if not exists operation_type text not null default 'outbound';
alter table public.picking_tasks add column if not exists assigned_operator text;
alter table public.picking_tasks add column if not exists started_at timestamptz;
alter table public.picking_tasks add column if not exists ended_at timestamptz;
alter table public.picking_tasks add column if not exists created_at timestamptz not null default now();
-- 可重複執行：已存在約束時先卸除再建立（避免 42710）
alter table public.picking_tasks
  drop constraint if exists picking_tasks_operation_type_check;
alter table public.picking_tasks
  add constraint picking_tasks_operation_type_check
  check (operation_type in ('inbound','outbound','stocktake'));

-- 僅對 operation_type = stocktake 有意義：true = 盲盤（現場隱藏帳面）；false = 核對模式
alter table public.picking_tasks add column if not exists is_blind_count boolean not null default false;

create unique index if not exists idx_picking_tasks_order_item
  on public.picking_tasks (order_no, item_no);

create index if not exists idx_picking_tasks_order on public.picking_tasks (order_no);
create index if not exists idx_picking_tasks_status on public.picking_tasks (status);
-- 首頁「我的今日任務」常用條件：status + assigned_operator
create index if not exists idx_picking_tasks_status_assigned_operator
  on public.picking_tasks (status, assigned_operator);

-- 現場紀錄（拋 ERP、損益、掃錯統計）
create table if not exists public.picking_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  task_id uuid references public.picking_tasks(id) on delete set null,
  order_no text not null,
  item_no text not null,
  nfc_uid text,
  actual_qty int not null default 0,
  operator text,
  operator_name text,
  variance_note text,
  mismatch_reason text
);
alter table public.picking_logs add column if not exists task_id uuid references public.picking_tasks(id) on delete set null;
alter table public.picking_logs add column if not exists operator_name text;
alter table public.picking_logs add column if not exists variance_note text;
alter table public.picking_logs add column if not exists mismatch_reason text;

create index if not exists idx_picking_logs_created on public.picking_logs (created_at desc);
create index if not exists idx_picking_logs_order on public.picking_logs (order_no);

alter table public.picking_tasks enable row level security;
alter table public.picking_logs enable row level security;
create table if not exists public.warehouse_operators (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  password text not null default '',
  created_at timestamptz not null default now()
);
alter table public.warehouse_operators add column if not exists active boolean not null default true;
alter table public.warehouse_operators add column if not exists password text not null default '';
alter table public.warehouse_operators add column if not exists company_id text not null default '';
alter table public.warehouse_operators enable row level security;

drop policy if exists picking_tasks_all on public.picking_tasks;
create policy picking_tasks_all on public.picking_tasks for all using (true) with check (true);
drop policy if exists picking_logs_all on public.picking_logs;
create policy picking_logs_all on public.picking_logs for all using (true) with check (true);
drop policy if exists warehouse_operators_all on public.warehouse_operators;
create policy warehouse_operators_all on public.warehouse_operators for all using (true) with check (true);

grant select, insert, update, delete on public.picking_tasks to anon, authenticated;
grant select, insert, update, delete on public.picking_logs to anon, authenticated;
grant select, insert, update, delete on public.warehouse_operators to anon, authenticated;

-- 可作為未來 ERP／企業級全域參數預留（盤點模式已改為 picking_tasks.is_blind_count）
create table if not exists public.warehouse_settings (
  id smallint primary key default 1 check (id = 1),
  is_blind_count boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.warehouse_settings (id, is_blind_count)
  values (1, false)
  on conflict (id) do nothing;
alter table public.warehouse_settings enable row level security;
drop policy if exists warehouse_settings_all on public.warehouse_settings;
create policy warehouse_settings_all on public.warehouse_settings for all using (true) with check (true);
grant select, insert, update, delete on public.warehouse_settings to anon, authenticated;
