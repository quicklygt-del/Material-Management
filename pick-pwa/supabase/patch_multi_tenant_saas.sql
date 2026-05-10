--  SaaS：租戶主檔、派單／日誌  隔離、平台標籤公版（Super Admin）
-- 與現有 label_records. / company_id 對齊；執行前請備份。

-- ── 租戶主檔（_code：000–999；_slug：與 QR 前綴／company_id 一致）──
create table if not exists public.s (
  _code text primary key
    check (_code ~ '^\d{3}$'),
  _slug text not null unique,
  company_name text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  feature_warehouse_ledger boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_s_status on public.s (status);

alter table public.s enable row level security;
drop policy if exists s_all on public.s;
create policy s_all on public.s for all using (true) with check (true);
grant select, insert, update, delete on public.s to anon, authenticated, service_role;

comment on table public.s is 'SaaS 租戶：Super Admin 管理； Admin 僅能存取所屬 _slug。';

-- 常用前綴種子（若已存在則略過）
insert into public.s (_code, _slug, company_name, status, feature_warehouse_ledger)
select '000', 'WMS', '預設租戶 WMS', 'active', true
where not exists (select 1 from public.s t where t._slug = 'WMS');

insert into public.s (_code, _slug, company_name, status, feature_warehouse_ledger)
select '001', '', '預設租戶 ', 'active', true
where not exists (select 1 from public.s t where t._slug = '');

-- ── picking_tasks / picking_logs：（與 _slug 字串一致）──
alter table public.picking_tasks add column if not exists  text not null default '';

update public.picking_tasks pt
set  = upper(
  regexp_replace(trim(coalesce(wo.company_id, '')), '[^A-Za-z0-9]', '', 'g')
)
from public.warehouse_operators wo
where trim(coalesce(pt.assigned_operator, '')) <> ''
  and trim(coalesce(pt.assigned_operator, '')) = trim(wo.name)
  and (pt. is null or trim(pt.) = '')
  and length(regexp_replace(trim(coalesce(wo.company_id, '')), '[^A-Za-z0-9]', '', 'g')) > 0;

update public.picking_tasks
set  = 'WMS'
where  is null or trim() = '';

alter table public.picking_logs add column if not exists  text not null default '';

update public.picking_logs pl
set  = coalesce(pt., 'WMS')
from public.picking_tasks pt
where pl.task_id is not null
  and pl.task_id = pt.id
  and (pl. is null or trim(pl.) = '');

update public.picking_logs
set  = 'WMS'
where  is null or trim() = '';

drop index if exists public.idx_picking_tasks_order_item;
create unique index if not exists idx_picking_tasks__order_item
  on public.picking_tasks (, order_no, item_no);

create index if not exists idx_picking_tasks__created
  on public.picking_tasks (, created_at desc);
create index if not exists idx_picking_tasks__status_assigned_operator
  on public.picking_tasks (, status, assigned_operator);

create index if not exists idx_picking_logs__created
  on public.picking_logs (, created_at desc);
create index if not exists idx_picking_logs__order
  on public.picking_logs (, order_no);

-- ── Super Admin：平台級標籤 Excel 比對公版 ──
create table if not exists public.platform_label_sheet_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  /** 與單位範本相同語意：欄位鍵順序／別名 JSON 陣列 */
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_label_templates_name
  on public.platform_label_sheet_templates ((lower(name)));

alter table public.platform_label_sheet_templates enable row level security;
drop policy if exists platform_label_sheet_templates_all on public.platform_label_sheet_templates;
create policy platform_label_sheet_templates_all
  on public.platform_label_sheet_templates for all using (true) with check (true);
grant select, insert, update, delete on public.platform_label_sheet_templates
  to anon, authenticated, service_role;

comment on table public.platform_label_sheet_templates is 'Super Admin 維護之全站標籤 Excel 比對公版';
