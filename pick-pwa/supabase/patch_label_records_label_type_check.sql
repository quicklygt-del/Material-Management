-- 修復 label_records_label_type_check：舊庫可能僅允許 S/R/B/Q，導致單位萬用區寫入 'D' 失敗。
-- 亦可選用 UNIVERSAL（與應用程式語意相容時與 D 並列）。
-- 在 Supabase SQL Editor 執行一次即可。

alter table public.label_records
  drop constraint if exists label_records_label_type_check;

alter table public.label_records
  add constraint label_records_label_type_check
  check (label_type in ('S', 'R', 'B', 'Q', 'D', 'UNIVERSAL'));

comment on constraint label_records_label_type_check on public.label_records is
  'S/R/B/Q 標準物料類型；D、UNIVERSAL 為單位萬用／自定義帳本標籤';
