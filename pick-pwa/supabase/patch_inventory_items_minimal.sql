-- 若 Console 尚無 inventory_items，可與 warehouse_ledger_stock 以 item_no ↔ item_no 對應 JOIN。
-- 若貴環境已有 ERP 表結構，請勿覆寫；僅供空庫或開發對齊。

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
   text not null,
  item_no text not null,
  item_name text not null default '',
  spec text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items__item_unique unique (, item_no)
);

create index if not exists idx_inventory_items__code
  on public.inventory_items (, lower(item_no));

alter table public.inventory_items enable row level security;
drop policy if exists inventory_items_all on public.inventory_items;
create policy inventory_items_all on public.inventory_items for all using (true) with check (true);
grant select, insert, update, delete on public.inventory_items to anon, authenticated;
grant select, insert, update, delete on public.inventory_items to service_role;
