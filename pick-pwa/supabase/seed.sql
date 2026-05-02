-- 先執行 schema.sql，再執行本檔
-- 目的：快速建立可測試「入庫/出貨/盤點 + NFC」資料

-- 1) 測試帳號（簡易帳密）
insert into public.app_users (username, password, role, company_id)
values
  ('admin', 'admin1234', 'admin', 'CARB'),
  ('warehouse1', 'wh1234', 'warehouse', 'CARB')
on conflict (username) do update
set
  password = excluded.password,
  role = excluded.role,
  company_id = coalesce(public.app_users.company_id, excluded.company_id);

-- 2) 測試品項（nfc_uid 請改成你實際標籤）
insert into public.items (sku, name, nfc_uid, current_stock)
values
  ('RM-001', '不鏽鋼螺絲', '04a1b2c3d4', 120),
  ('RM-002', '電工膠帶', '04e5f6a7b8', 80),
  ('RM-003', '塑膠手套', '0499aa77cc', 200)
on conflict (nfc_uid) do update
set
  sku = excluded.sku,
  name = excluded.name,
  current_stock = excluded.current_stock;

-- 3) 建立三張待處理單據（入庫/出貨/盤點）
insert into public.orders (order_no, operation_type, assigned_operator, status)
values
  ('IN-20260428-001', 'inbound', 'warehouse1', 'pending'),
  ('OUT-20260428-001', 'outbound', 'warehouse1', 'pending'),
  ('ST-20260428-001', 'stocktake', 'warehouse1', 'pending')
on conflict (order_no) do update
set
  operation_type = excluded.operation_type,
  assigned_operator = excluded.assigned_operator,
  status = 'pending';

-- 4) 依單號插入明細（避免重覆資料）
delete from public.order_items
where order_id in (
  select id from public.orders
  where order_no in ('IN-20260428-001', 'OUT-20260428-001', 'ST-20260428-001')
);

insert into public.order_items (order_id, item_id, nfc_uid, required_qty, picked_qty)
select
  o.id,
  i.id,
  i.nfc_uid,
  case
    when o.operation_type = 'inbound' then 30
    when o.operation_type = 'outbound' then 20
    else 1
  end as required_qty,
  0 as picked_qty
from public.orders o
join public.items i on i.nfc_uid in ('04a1b2c3d4', '04e5f6a7b8')
where o.order_no in ('IN-20260428-001', 'OUT-20260428-001')
union all
select
  o.id,
  i.id,
  i.nfc_uid,
  1 as required_qty,
  0 as picked_qty
from public.orders o
join public.items i on i.nfc_uid = '0499aa77cc'
where o.order_no = 'ST-20260428-001';

-- 5) 起始日誌
insert into public.activity_logs (action, order_id, nfc_uid, operator_name, message)
select
  'seed_ready',
  o.id,
  null,
  'system',
  '測試資料已建立，可開始作業測試'
from public.orders o
where o.order_no in ('IN-20260428-001', 'OUT-20260428-001', 'ST-20260428-001');
