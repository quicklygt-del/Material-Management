-- 測試用：補一些作業紀錄，方便後台監控與報表驗證

insert into public.activity_logs (action, order_id, nfc_uid, operator_name, message, meta)
select
  'inbound_success',
  o.id,
  '04a1b2c3d4',
  'warehouse1',
  '入庫 10，庫存 120 -> 130',
  '{"qty":10,"before_stock":120,"after_stock":130}'::jsonb
from public.orders o
where o.order_no = 'IN-20260428-001';

insert into public.activity_logs (action, order_id, nfc_uid, operator_name, message, meta)
select
  'outbound_success',
  o.id,
  '04e5f6a7b8',
  'warehouse1',
  '出貨 5，庫存 80 -> 75',
  '{"qty":5,"before_stock":80,"after_stock":75}'::jsonb
from public.orders o
where o.order_no = 'OUT-20260428-001';

insert into public.activity_logs (action, order_id, nfc_uid, operator_name, message, meta)
select
  'scan_mismatch',
  o.id,
  '04xxxx9999',
  'warehouse1',
  '非此單據物料，禁止領取！',
  null
from public.orders o
where o.order_no = 'OUT-20260428-001';
