-- 已存在之資料庫：將 universal_ledger_records.unit_id 改為 ON DELETE CASCADE
-- （刪除管理單位時一併刪除該單位之異動明細）
-- Supabase SQL Editor 執行一次。

alter table public.universal_ledger_records
  drop constraint if exists universal_ledger_records_unit_id_fkey;

alter table public.universal_ledger_records
  add constraint universal_ledger_records_unit_id_fkey
  foreign key (unit_id) references public.storage_zones (id) on delete cascade;
