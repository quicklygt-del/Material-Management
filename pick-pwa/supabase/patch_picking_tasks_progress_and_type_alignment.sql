-- 補強 picking_tasks 進度欄位與類型一致性（可重複執行）
-- 1) 新增 picked_qty（numeric）供進度條直接讀取
-- 2) 若缺少 task_type，補上欄位並回填為與 operation_type 一致

alter table public.picking_tasks
  add column if not exists picked_qty numeric not null default 0;

alter table public.picking_tasks
  add column if not exists task_type text;

update public.picking_tasks
set task_type = case operation_type
  when 'inbound' then '入庫'
  when 'stocktake' then '盤點'
  else '領料'
end
where task_type is null
   or trim(task_type) = ''
   or task_type not in ('入庫', '領料', '盤點');

-- 防止未來資料再出現 task_type / operation_type 不一致
create or replace function public.sync_picking_task_type_from_operation()
returns trigger
language plpgsql
as $$
begin
  new.task_type := case new.operation_type
    when 'inbound' then '入庫'
    when 'stocktake' then '盤點'
    else '領料'
  end;
  return new;
end;
$$;

drop trigger if exists trg_sync_picking_task_type on public.picking_tasks;
create trigger trg_sync_picking_task_type
before insert or update of operation_type
on public.picking_tasks
for each row
execute function public.sync_picking_task_type_from_operation();
