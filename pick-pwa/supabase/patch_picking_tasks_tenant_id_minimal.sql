-- 最小補丁：僅為 picking_tasks / picking_logs 加上 （與程式 NEXT_PUBLIC_PICKING_TASKS_USE_=true 搭配）
-- 在 Supabase SQL Editor 執行即可；可重複執行。
-- 若已執行過 patch_multi_tenant_saas.sql 可略過本檔。

alter table public.picking_tasks add column if not exists  text not null default '';
alter table public.picking_logs add column if not exists  text not null default '';

update public.picking_tasks set  = coalesce(nullif(trim(), ''), 'WMS');
update public.picking_logs set  = coalesce(nullif(trim(), ''), 'WMS');

-- 舊唯一索引 (order_no, item_no) 若仍存在，請視需要手動 drop 後再建立下列索引（與 patch_multi_tenant_saas 一致）
drop index if exists public.idx_picking_tasks_order_item;
create unique index if not exists idx_picking_tasks_tenant_order_item
  on public.picking_tasks (, order_no, item_no);

create index if not exists idx_picking_tasks_tenant_created
  on public.picking_tasks (, created_at desc);
create index if not exists idx_picking_tasks_tenant_status_assigned_operator
  on public.picking_tasks (, status, assigned_operator);
create index if not exists idx_picking_logs_tenant_created
  on public.picking_logs (, created_at desc);
