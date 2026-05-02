-- 將虛擬倉庫表更名為 storage_zones（PostgreSQL 會保留 FK）。
-- 若已為 storage_zones 則略過。新環境請直接執行 schema_warehouse_inventory.sql。

do $$
begin
  if to_regclass('public.warehouses') is not null
     and to_regclass('public.storage_zones') is null then
    alter table public.warehouses rename to storage_zones;
  end if;
end $$;
