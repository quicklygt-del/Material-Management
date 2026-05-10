create table if not exists public.inventory_flow (
  id uuid primary key default gen_random_uuid(),
  item_no text not null default '',
  po_no text not null default '',
  item_name text not null default '',
  current_stage text not null default 'pending_inspect',
  location_label text not null default '',
  entered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_flow_item_no on public.inventory_flow (item_no);
create index if not exists idx_inventory_flow_po_no on public.inventory_flow (po_no);
create index if not exists idx_inventory_flow_entered on public.inventory_flow (entered_at desc);

alter table public.inventory_flow enable row level security;
drop policy if exists inventory_flow_all on public.inventory_flow;
create policy inventory_flow_all on public.inventory_flow for all using (true) with check (true);
grant select, insert, update, delete on public.inventory_flow to anon, authenticated;
grant select, insert, update, delete on public.inventory_flow to service_role;
