-- 標籤中心：多租戶隔離（請於 schema_labels.sql 之後執行）
-- 1) 帳號綁定 company_id（與 label_records. / QR 第一段一致）
-- 2) 撤銷 anon／authenticated 對 label_records 的直接存取；改由後端 API（service_role）寫入

alter table public.app_users
  add column if not exists company_id text not null default '';

alter table public.warehouse_operators
  add column if not exists company_id text not null default '';

comment on column public.app_users.company_id is '企業識別碼，與標籤 QR 第一段、label_records. 一致';
comment on column public.warehouse_operators.company_id is '企業識別碼，與標籤 QR 第一段、label_records. 一致';

-- 可依實際租戶更新預設（下列為範例）
-- update public.app_users set company_id = 'RMC' where username = 'admin';

alter table public.label_records enable row level security;

-- 移除舊版「全開」政策（schema_labels.sql）
drop policy if exists label_records_all on public.label_records;
drop policy if exists label_records_deny_anon on public.label_records;

-- 匿名／一般 JWT 使用者不可直接讀寫（須 service_role 繞過 RLS 或由後端驗證後寫入）
create policy label_records_deny_anon
  on public.label_records
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.label_records from anon;
revoke all on public.label_records from authenticated;

-- service_role 仍可由後端金鑰完整操作（略過 RLS）
grant select, insert, update, delete on public.label_records to service_role;
