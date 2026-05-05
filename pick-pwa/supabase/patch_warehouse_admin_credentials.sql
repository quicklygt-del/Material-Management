-- 倉儲主管帳號 warehouse_admin／密碼 wa12345，並將舊 role 值遷移後套用新檢查約束。
-- 在 Supabase SQL Editor 整段執行一次即可。

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

insert into public.app_users (username, password, role, company_id)
values ('warehouse_admin', 'wa12345', 'warehouse_admin', 'CARB')
on conflict (username) do update
set
  password = excluded.password,
  role = excluded.role,
  company_id = coalesce(public.app_users.company_id, excluded.company_id);
