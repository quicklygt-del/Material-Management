-- v0.18.0 其他作業區｜門禁與單位專屬路徑
-- 請於 Supabase SQL Editor 執行（相容既有 storage_zones）

alter table public.storage_zones
  add column if not exists slug text;

alter table public.storage_zones
  add column if not exists portal_login text not null default '';

alter table public.storage_zones
  add column if not exists portal_password text not null default '';

alter table public.storage_zones
  add column if not exists invite_token text;

alter table public.storage_zones
  add column if not exists invite_expires_at timestamptz;

comment on column public.storage_zones.slug is 'URL path /unit/[slug]，每租戶唯一';

comment on column public.storage_zones.portal_login is '單位門禁登入帳號（每租戶唯一）';

-- 既有資料回填 slug（僅適用無 slug）
update public.storage_zones z
set slug = concat(
        'zone-',
        substr(replace(z.id::text, '-', ''), 1, 12)
      )
where (z.slug is null or trim(z.slug) = '')
  and not exists (
        select 1
        from public.storage_zones o
        where o. = z.
          and o.slug = concat('zone-', substr(replace(z.id::text, '-', ''), 1, 12))
          and o.id <> z.id
      );

update public.storage_zones z
set slug = concat('zone-', substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
where z.slug is null or trim(z.slug) = '';

create unique index if not exists idx_storage_zones_tenant_slug
  on public.storage_zones (, slug)
  where slug is not null and length(trim(slug)) > 0;

create unique index if not exists idx_storage_zones_tenant_portal_login
  on public.storage_zones (, portal_login)
  where length(trim(portal_login)) > 0;
