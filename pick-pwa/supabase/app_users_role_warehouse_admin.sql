-- app_users.role：倉儲主管（warehouse_admin）、系統管理（system_admin）、倉管 app 帳（warehouse_staff）。
-- 新專案請以 schema.sql 為準；既有庫請執行 patch_identity_roles_v1.sql。

alter table public.app_users
  drop constraint if exists app_users_role_check;

alter table public.app_users
  add constraint app_users_role_check
  check (role in ('warehouse_admin', 'system_admin', 'warehouse_staff'));
