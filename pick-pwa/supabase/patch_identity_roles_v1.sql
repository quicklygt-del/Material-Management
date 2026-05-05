-- 身分重整 v1：app_users.role 由 admin→system_admin、warehouse→warehouse_staff；檢查約束同步。
-- 在 Supabase SQL Editor 執行一次。

alter table public.app_users
  drop constraint if exists app_users_role_check;

update public.app_users
set role = 'system_admin'
where role = 'admin';

update public.app_users
set role = 'warehouse_staff'
where role = 'warehouse';

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('warehouse_admin', 'system_admin', 'warehouse_staff'));
