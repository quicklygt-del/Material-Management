-- 在 Supabase SQL Editor 執行（可依現有表名微調）
-- 表：items, orders, order_items, activity_logs

create extension if not exists "pgcrypto";

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  sku text,
  name text not null,
  nfc_uid text unique,
  current_stock numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table public.items add column if not exists sku text;
alter table public.items add column if not exists nfc_uid text;
alter table public.items add column if not exists current_stock numeric not null default 0;
alter table public.items add column if not exists created_at timestamptz not null default now();
create unique index if not exists idx_items_nfc_uid_unique on public.items (nfc_uid);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  operation_type text not null default 'outbound' check (operation_type in ('inbound', 'outbound', 'stocktake')),
  assigned_operator text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.orders add column if not exists operation_type text not null default 'outbound';
alter table public.orders add column if not exists assigned_operator text;
alter table public.orders add column if not exists started_at timestamptz;
alter table public.orders add column if not exists ended_at timestamptz;
alter table public.orders add column if not exists created_at timestamptz not null default now();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  nfc_uid text not null,
  required_qty int not null default 1 check (required_qty > 0),
  picked_qty int not null default 0 check (picked_qty >= 0),
  updated_at timestamptz not null default now()
);
alter table public.order_items add column if not exists item_id uuid references public.items(id) on delete set null;
alter table public.order_items add column if not exists nfc_uid text;
alter table public.order_items add column if not exists required_qty int not null default 1;
alter table public.order_items add column if not exists picked_qty int not null default 0;
alter table public.order_items add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_nfc on public.order_items(lower(nfc_uid));

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  action text not null,
  order_id uuid references public.orders(id) on delete set null,
  nfc_uid text,
  operator_name text,
  message text,
  meta jsonb
);

create index if not exists idx_activity_created on public.activity_logs(created_at desc);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password text not null,
  role text not null check (role in ('warehouse_admin', 'system_admin', 'warehouse_staff')),
  created_at timestamptz not null default now()
);
alter table public.app_users add column if not exists created_at timestamptz not null default now();
alter table public.app_users add column if not exists company_id text not null default 'CARB';

-- 開發期簡化：若你使用 anon key 直連資料庫，需開放對應權限
alter table public.app_users enable row level security;
drop policy if exists app_users_read_all on public.app_users;
create policy app_users_read_all on public.app_users for select using (true);
drop policy if exists app_users_write_all on public.app_users;
create policy app_users_write_all on public.app_users for all using (true) with check (true);
grant select, insert, update, delete on public.app_users to anon, authenticated;

-- picking_tasks 結構修正（多品項同單號）
-- 目標：保持每列任務獨立，不使用 order_no 唯一約束。
alter table if exists public.picking_tasks
  add column if not exists id uuid default gen_random_uuid();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'picking_tasks' and column_name = 'id'
  ) then
    begin
      execute 'alter table public.picking_tasks add primary key (id)';
    exception
      when duplicate_table then null;
      when duplicate_object then null;
    end;
  end if;
end $$;

drop index if exists public.picking_tasks_order_no_key;
drop index if exists public.idx_picking_tasks_order_no_unique;

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'picking_tasks'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%(order_no)%'
  ) then
    execute (
      select 'alter table public.picking_tasks drop constraint ' || quote_ident(c.conname)
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'picking_tasks'
        and c.contype = 'u'
        and pg_get_constraintdef(c.oid) like '%(order_no)%'
      limit 1
    );
  end if;
end $$;

create index if not exists idx_picking_tasks_order_no on public.picking_tasks(order_no);
create index if not exists idx_picking_tasks_order_item on public.picking_tasks(order_no, item_no);

-- 盤點模式：task 層級；true = 盲盤（現場隱藏帳面）
alter table if exists public.picking_tasks add column if not exists is_blind_count boolean not null default false;

-- WMS 單據/品項一對多結構
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  operation_type text not null default 'outbound',
  assigned_operator text,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column if not exists operation_type text not null default 'outbound';
alter table public.orders
  add column if not exists assigned_operator text;
alter table public.orders
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_no text not null,
  item_name text,
  required_qty int not null default 0,
  location text,
  created_at timestamptz not null default now()
);

alter table public.order_items
  add column if not exists item_no text;
alter table public.order_items
  add column if not exists item_name text;
alter table public.order_items
  add column if not exists required_qty int not null default 0;
alter table public.order_items
  add column if not exists location text;
alter table public.order_items
  add column if not exists created_at timestamptz not null default now();

-- 兼容舊版欄位設定，允許改由 item_no/item_name 維護品項資料
alter table public.order_items
  alter column nfc_uid drop not null;

create index if not exists idx_orders_order_no on public.orders(order_no);
create index if not exists idx_order_items_order_id on public.order_items(order_id);
