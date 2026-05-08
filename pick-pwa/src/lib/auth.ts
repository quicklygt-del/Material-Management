import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeLabelPrefix } from "@/lib/labelEncoding";
import { withTenantParam } from "@/lib/tenantNav";

/** 正式身分（DB／Session 以新值為準；舊值讀取時會正規化） */
export type UserRole = "warehouse_admin" | "system_admin" | "warehouse_staff";

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
  /** 與標籤前綴／company_id 一致；Tenant Admin／Operator 登入後寫入 */
  tenant_slug?: string;
};

const STORAGE_KEY = "pick-pwa-session";

/** 將 DB 或舊版 localStorage 角色轉成現行 UserRole */
export function normalizeRole(
  raw: string | null | undefined,
): UserRole | null {
  if (!raw) return null;
  if (raw === "warehouse_admin") return "warehouse_admin";
  if (raw === "system_admin" || raw === "admin") return "system_admin";
  if (raw === "warehouse_staff" || raw === "warehouse") {
    return "warehouse_staff";
  }
  return null;
}

/** UI 顯示：倉儲主管、系統管理（其他作業區）、倉管員 */
export function roleDisplayLabel(role: UserRole | undefined): string {
  if (role === "warehouse_admin") return "倉儲主管";
  if (role === "system_admin") return "系統管理（其他作業區）";
  if (role === "warehouse_staff") return "倉管員";
  return "未指定身分";
}

export function postLoginRedirectPath(role: UserRole): string {
  if (role === "warehouse_admin") return "/admin";
  if (role === "warehouse_staff") return "/operator";
  if (role === "system_admin") return "/admin/other-operations";
  return "/";
}

/** 回到首頁登入：清除 pick-pwa 本機身分，避免已登入者被自動導回後台造成循環。 */
export function exitToLoginHome(router: { replace: (href: string) => void }) {
  clearSessionUser();
  router.replace(withTenantParam("/"));
}

function isValidStoredRole(x: unknown): x is UserRole {
  return (
    x === "warehouse_admin" ||
    x === "system_admin" ||
    x === "warehouse_staff" ||
    x === "admin" ||
    x === "warehouse"
  );
}

function isValidSessionShape(x: unknown): x is SessionUser {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.username !== "string" ||
    !isValidStoredRole(o.role)
  ) {
    return false;
  }
  if (o.tenant_slug != null && typeof o.tenant_slug !== "string") {
    return false;
  }
  return true;
}

function normalizeSessionUser(raw: SessionUser): SessionUser {
  const nr = normalizeRole(raw.role);
  if (!nr) return raw;
  const slugRaw =
    typeof raw.tenant_slug === "string" ? raw.tenant_slug.trim() : "";
  const tenant_slug =
    slugRaw !== "" ? normalizeLabelPrefix(slugRaw) : undefined;
  const next = { ...raw, role: nr };
  if (tenant_slug !== undefined) next.tenant_slug = tenant_slug;
  else delete (next as { tenant_slug?: string }).tenant_slug;
  return next;
}

/** 派單控制台、資產分頁、標籤中心：僅倉儲主管 */
export function canAccessWarehouseDashboard(
  role: UserRole | string | undefined,
): boolean {
  return normalizeRole(String(role ?? "")) === "warehouse_admin";
}

/** 倉管員維護頁：僅倉儲主管（與 system_admin 分離） */
export function canAccessAdminSettingsPage(
  role: UserRole | string | undefined,
): boolean {
  return normalizeRole(String(role ?? "")) === "warehouse_admin";
}

/** 其他作業區全系統後台：僅系統管理 */
export function canAccessOtherOperationsAdmin(
  role: UserRole | string | undefined,
): boolean {
  return normalizeRole(String(role ?? "")) === "system_admin";
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSessionShape(parsed)) return null;
    const normalized = normalizeSessionUser(parsed);
    if (normalized.role !== parsed.role) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
}

export function saveSessionUser(user: SessionUser) {
  if (typeof window === "undefined") return;
  const normalized = normalizeSessionUser(user);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function clearSessionUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export async function fetchLoginIdentities(
  supabase: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("warehouse_operators")
    .select("name,active")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((x) => String(x.name));
}

export type UnifiedLoginResult =
  | { ok: true; user: SessionUser }
  | { ok: true; kind: "unit"; slug: string }
  | { ok: false; message: string };

/**
 * 單一入口：app_users（倉儲主管／系統管理／舊倉儲 app 帳）→ warehouse_operators（倉管員）→ 單位門禁。
 */
export async function loginUnifiedByPassword(
  supabase: SupabaseClient,
  username: string,
  password: string,
  tenantId: string,
  opts?: { skipUnitPortal?: boolean },
): Promise<UnifiedLoginResult> {
  const name = username.trim();
  const pwd = password;
  const skipUnit = opts?.skipUnitPortal === true;
  if (!name || !pwd.trim()) {
    return { ok: false, message: "請輸入帳號與密碼" };
  }

  if (typeof window !== "undefined") {
    try {
      const res = await fetch(
        `${window.location.origin}/api/auth/unified-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: name, password: pwd }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        username?: string;
        role?: string;
        tenant_slug?: string;
      };
      if (res.ok && j.id && j.username && j.role) {
        const nr = normalizeRole(j.role);
        if (!nr) {
          return { ok: false, message: "無法辨識帳號身分" };
        }
        const tenantRaw = String(j.tenant_slug ?? "").trim();
        const user: SessionUser = {
          id: String(j.id),
          username: String(j.username),
          role: nr,
          ...(tenantRaw !== ""
            ? { tenant_slug: normalizeLabelPrefix(tenantRaw) }
            : {}),
        };
        saveSessionUser(user);
        return { ok: true, user };
      }
      if (res.status !== 503) {
        if (res.status === 401 || res.status === 404) {
          void 0;
        } else if (!res.ok && j.error) {
          return { ok: false, message: j.error };
        }
      }
    } catch {
      void 0;
    }
  }

  const { data: appRow, error: appErr } = await supabase
    .from("app_users")
    .select("id,username,role,company_id")
    .eq("username", name)
    .eq("password", pwd)
    .maybeSingle();
  if (appErr) {
    return { ok: false, message: `登入查詢失敗：${appErr.message}` };
  }
  if (appRow) {
    const nr = normalizeRole(String(appRow.role ?? ""));
    if (!nr) {
      return { ok: false, message: "帳號或密碼錯誤" };
    }
    const cid = String(
      (appRow as { company_id?: string }).company_id ?? "",
    ).trim();
    const user: SessionUser = {
      id: String(appRow.id),
      username: String(appRow.username),
      role: nr,
      ...(cid !== "" ? { tenant_slug: normalizeLabelPrefix(cid) } : {}),
    };
    saveSessionUser(user);
    return { ok: true, user };
  }

  const { data: op, error: opErr } = await supabase
    .from("warehouse_operators")
    .select("id,name,active,password,company_id")
    .eq("name", name)
    .eq("active", true)
    .eq("password", pwd)
    .limit(1)
    .maybeSingle();
  if (opErr) {
    return { ok: false, message: `登入查詢失敗：${opErr.message}` };
  }
  if (op) {
    const cid = String(
      (op as { company_id?: string }).company_id ?? "",
    ).trim();
    const user: SessionUser = {
      id: String(op.id),
      username: String(op.name),
      role: "warehouse_staff",
      ...(cid !== "" ? { tenant_slug: normalizeLabelPrefix(cid) } : {}),
    };
    saveSessionUser(user);
    return { ok: true, user };
  }

  if (name.toLowerCase() === "admin") {
    return { ok: false, message: "帳號或密碼錯誤" };
  }

  if (skipUnit) {
    return { ok: false, message: "帳號或密碼錯誤" };
  }

  if (typeof window !== "undefined") {
    try {
      const res = await fetch("/api/unit-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          : tenantId,
          portal_login: name,
          password: pwd,
        }),
      });
      const j = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) {
        return { ok: false, message: j.error ?? "帳號或密碼錯誤" };
      }
      const slug = j.slug?.trim();
      if (!slug) {
        return { ok: false, message: "未取得單位路徑" };
      }
      return { ok: true, kind: "unit", slug };
    } catch {
      return { ok: false, message: "單位登入連線失敗" };
    }
  }

  return { ok: false, message: "帳號或密碼錯誤" };
}

export async function loginWarehouseByPassword(
  supabase: SupabaseClient,
  username: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; message: string }> {
  const r = await loginUnifiedByPassword(supabase, username, password, "", {
    skipUnitPortal: true,
  });
  if (r.ok && "user" in r) {
    if (r.user.role !== "warehouse_staff") {
      return { ok: false, message: "請使用倉管員帳密登入" };
    }
    return { ok: true, user: r.user };
  }
  if (!r.ok) return r;
  return { ok: false, message: "請使用倉管員帳密登入" };
}

export async function loginWarehouseAdminByPassword(
  supabase: SupabaseClient,
  username: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; message: string }> {
  const r = await loginUnifiedByPassword(supabase, username, password, "", {
    skipUnitPortal: true,
  });
  if (r.ok && "user" in r) {
    if (r.user.role !== "warehouse_admin") {
      return { ok: false, message: "請使用倉儲主管帳密登入" };
    }
    return { ok: true, user: r.user };
  }
  if (!r.ok) return r;
  return { ok: false, message: "請使用倉儲主管帳密登入" };
}

export async function loginByPassword(
  supabase: SupabaseClient,
  username: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; message: string }> {
  const name = username.trim();
  if (name.toLowerCase() !== "admin") {
    return { ok: false, message: "請使用 admin 帳號" };
  }
  const r = await loginUnifiedByPassword(supabase, "admin", password, "");
  if (r.ok && "user" in r) {
    if (r.user.role !== "system_admin") {
      return { ok: false, message: "帳號或密碼錯誤" };
    }
    return { ok: true, user: r.user };
  }
  if (!r.ok) return r;
  return { ok: false, message: "帳號或密碼錯誤" };
}
