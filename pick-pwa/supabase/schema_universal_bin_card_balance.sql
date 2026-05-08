-- 數位物料卡：每筆紀錄附摘要與當下結餘（須已存在 universal_ledger_records）
--
-- 若執行時出現「relation universal_ledger_records 不存在」，
-- 請改為執行完整安裝：install_universal_bin_card_system.sql（會建立資料表）

alter table public.universal_ledger_records
  add column if not exists summary text;

alter table public.universal_ledger_records
  add column if not exists balance_after integer not null default 0;

comment on column public.universal_ledger_records.summary is '物料卡摘要（通常為標籤內容說明）';
comment on column public.universal_ledger_records.balance_after is '本筆異動後該標籤於此單位之結餘';

-- 既有資料：依時間重算累計結餘（同一 tenant + unit + 標籤）
update public.universal_ledger_records AS u
SET balance_after = s.bal::integer
FROM (
  SELECT id,
    SUM(quantity_delta) OVER (
      PARTITION BY , unit_id, COALESCE(label_record_id::text, qr_payload)
      ORDER BY created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS bal
  FROM public.universal_ledger_records
) AS s
WHERE u.id = s.id;
