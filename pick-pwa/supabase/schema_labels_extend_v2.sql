-- 延伸標籤類型：D＝研發樣品（若約束名不同請於 SQL Editor 調整）
alter table public.label_records
  drop constraint if exists label_records_label_type_check;

alter table public.label_records
  add constraint label_records_label_type_check
  check (label_type in ('S', 'R', 'B', 'Q', 'D'));
