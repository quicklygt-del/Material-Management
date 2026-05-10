-- 單位標籤列印範本（供系統管理後台設定，綁定 storage_zones.label_template_id）
-- 請於 Supabase SQL Editor 執行

create table if not exists public.label_print_templates (
  id uuid primary key default gen_random_uuid(),
   text not null,
  name text not null,
  /** 欄位順序：[{ "key": "item_no", "label_zh": "料號" }, ...]；须包含一筆 key = print_count */
  field_definitions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.label_print_templates is '作業單位標籤 Excel／QR 欄位範本';

create index if not exists idx_label_print_templates_
  on public.label_print_templates ();

alter table public.storage_zones
  add column if not exists label_template_id uuid
  references public.label_print_templates (id) on delete set null;

create index if not exists idx_storage_zones_label_template
  on public.storage_zones (label_template_id)
  where label_template_id is not null;

alter table public.label_print_templates enable row level security;
drop policy if exists label_print_templates_all on public.label_print_templates;
create policy label_print_templates_all on public.label_print_templates
  for all using (true) with check (true);
grant select, insert, update, delete on public.label_print_templates to anon, authenticated;
grant select, insert, update, delete on public.label_print_templates to service_role;
