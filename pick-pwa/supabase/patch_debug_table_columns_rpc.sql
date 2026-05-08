-- 供 API / 診斷端點查詢 information_schema（空表亦可列出欄位）
-- 僅授予 service_role 執行；請於 Supabase SQL Editor 執行一次

create or replace function public.debug_table_columns(p_table text)
returns table(column_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.column_name::text
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
  order by c.ordinal_position;
$$;

revoke all on function public.debug_table_columns(text) from public;
grant execute on function public.debug_table_columns(text) to service_role;
