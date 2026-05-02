import type { SupabaseClient } from "@supabase/supabase-js";

export type UserRole = "warehouse" | "admin";

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
};

const STORAGE_KEY = "pick-pwa-session";

function isValidSessionUser(x: unknown): x is SessionUser {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.username === "string" &&
    (o.role === "warehouse" || o.role === "admin")
  );
}

export function getSessionUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSessionUser(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSessionUser(user: SessionUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
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
  const names = (data ?? []).map((x) => String(x.name));
  return ["admin", ...names];
}

export async function loginByPassword(
  supabase: SupabaseClient,
  username: string,
  password: string
): Promise<{ ok: true; user: SessionUser } | { ok: false; message: string }> {
  const name = username.trim();
  if (!name || !password.trim()) {
    return { ok: false, message: "請輸入帳號與密碼" };
  }
  if (name === "admin") {
    const { data, error } = await supabase
      .from("app_users")
      .select("id,username,role")
      .eq("role", "admin")
      .eq("password", password)
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, message: `登入查詢失敗：${error.message}` };
    if (!data) return { ok: false, message: "帳號或密碼錯誤" };
    const user: SessionUser = {
      id: String(data.id),
      username: "admin",
      role: "admin",
    };
    saveSessionUser(user);
    return { ok: true, user };
  }

  const { data: op, error: opErr } = await supabase
    .from("warehouse_operators")
    .select("id,name,active,password")
    .eq("name", name)
    .eq("active", true)
    .eq("password", password)
    .limit(1)
    .maybeSingle();
  if (opErr) return { ok: false, message: `登入查詢失敗：${opErr.message}` };
  if (!op) return { ok: false, message: "帳號或密碼錯誤" };
  const user: SessionUser = {
    id: String(op.id),
    username: String(op.name),
    role: "warehouse",
  };
  saveSessionUser(user);
  return { ok: true, user };
}
