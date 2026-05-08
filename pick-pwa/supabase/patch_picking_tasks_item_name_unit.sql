-- Ensure picking_tasks has product name/spec and unit columns
alter table public.picking_tasks
  add column if not exists item_name text;

alter table public.picking_tasks
  add column if not exists unit text;

alter table public.picking_tasks
  add column if not exists spec text;
