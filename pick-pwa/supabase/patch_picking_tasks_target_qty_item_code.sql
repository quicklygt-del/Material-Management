-- Single-tenant simplification for existing public.picking_tasks
-- 1) unify quantity columns to numeric: target_qty + picked_qty
-- 2) unify item key to item_code
-- 3) keep existing table, no new table
--
-- 相容「已刪除 item_no / required_qty」的庫：僅在欄位存在時才回填。

alter table public.picking_tasks
  add column if not exists item_code text;

alter table public.picking_tasks
  add column if not exists item_name text;

alter table public.picking_tasks
  add column if not exists unit text;

-- 若有舊欄位 item_no，才用它回填 item_code
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'picking_tasks'
      and column_name = 'item_no'
  ) then
    update public.picking_tasks
    set item_code = coalesce(
      nullif(trim(item_code), ''),
      nullif(trim(item_no), '')
    )
    where item_code is null or trim(item_code) = '';
  end if;
end $$;

alter table public.picking_tasks
  alter column item_code set not null;

alter table public.picking_tasks
  add column if not exists target_qty numeric not null default 0;

-- 若有舊欄位 required_qty，才用它回填 target_qty
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'picking_tasks'
      and column_name = 'required_qty'
  ) then
    update public.picking_tasks
    set target_qty = coalesce(target_qty, required_qty::numeric, 0);
  end if;
end $$;

alter table public.picking_tasks
  add column if not exists picked_qty numeric not null default 0;

update public.picking_tasks
set picked_qty = coalesce(picked_qty, 0);

-- Drop legacy columns after backfill（若仍存在）
alter table public.picking_tasks drop column if exists item_no cascade;
alter table public.picking_tasks drop column if exists required_qty cascade;

-- Rebuild unique index on single-tenant key
drop index if exists public.idx_picking_tasks_order_item;
drop index if exists public.idx_picking_tasks_tenant_order_item;
create unique index if not exists idx_picking_tasks_order_item_code
  on public.picking_tasks (order_no, item_code);
