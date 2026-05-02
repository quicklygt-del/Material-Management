-- 標籤中心：標籤列印紀錄（依 tenant_id 隔離）
create table if not exists public.label_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  label_type text not null check (label_type in ('S','R','B','Q')),
  qr_payload text not null,
  item_no text not null,
  color_code text,
  operator_id text,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_label_records_tenant_created
  on public.label_records (tenant_id, created_at desc);

alter table public.label_records enable row level security;
drop policy if exists label_records_all on public.label_records;
create policy label_records_all on public.label_records for all using (true) with check (true);
grant select, insert, update, delete on public.label_records to anon, authenticated;

-- 多租戶正式環境請改執行 schema_labels_rls.sql（撤銷 anon 直連，改由後端 API + service_role）
