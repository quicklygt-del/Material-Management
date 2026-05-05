"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_BRAND_TAGLINE } from "@/components/AppBrandHeader";
import {
  clearSessionUser,
  getSessionUser,
  loginUnifiedByPassword,
  postLoginRedirectPath,
  type SessionUser,
} from "@/lib/auth";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

const MANUAL_SENTINEL = "__manual__";

/**
 * 修正後的排序邏輯：
 * 1. 確保 admin 與 warehouse_admin 永遠在最上方[cite: 5]
 * 2. 隨後依據中文/英文字母排序其他動態帳號[cite: 5]
 */
function sortUsernames(usernames: string[]): string[] {
  const priority = ["admin", "warehouse_admin"];
  
  const u = Array.from(
    new Set([...priority, ...usernames.map((x) => x.trim()).filter(Boolean)]),
  );

  u.sort((a, b) => {
    if (priority.includes(a) && !priority.includes(b)) return -1;
    if (!priority.includes(a) && priority.includes(b)) return 1;
    if (priority.includes(a) && priority.includes(b)) {
      return priority.indexOf(a) - priority.indexOf(b);
    }
    return a.localeCompare(b, "zh-Hant");
  });
  return u;
}

async function loadUsernamesClientFallback(
  portalTenant: string,
): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  const tenant =
    normalizeLabelPrefix(portalTenant) || getDefaultLabelPrefix();
  const seen = new Set<string>();

  // 抓取管理權限帳號[cite: 5]
  const { data: appRows } = await supabase
    .from("app_users")
    .select("username")
    .in("role", ["admin", "system_admin", "warehouse_admin"])
    .eq("company_id", tenant);
  for (const row of appRows ?? []) {
    const x = String(row.username ?? "").trim();
    if (x) seen.add(x);
  }

  // 抓取動態倉管員名單[cite: 5]
  const { data: opRows } = await supabase
    .from("warehouse_operators")
    .select("name")
    .eq("active", true)
    .eq("company_id", tenant);
  for (const row of opRows ?? []) {
    const x = String(row.name ?? "").trim();
    if (x) seen.add(x);
  }

  const { data: zoneRows } = await supabase
    .from("storage_zones")
    .select("portal_login")
    .eq("tenant_id", tenant);
  for (const row of zoneRows ?? []) {
    const x = String(row.portal_login ?? "").trim();
    if (x) seen.add(x);
  }

  return sortUsernames(Array.from(seen));
}

export default function HomePage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [accountPick, setAccountPick] = useState("");
  const [manualAccount, setManualAccount] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usernames, setUsernames] = useState<string[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [portalTenant, setPortalTenant] = useState(() =>
    getDefaultLabelPrefix(),
  );
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const q = normalizeLabelPrefix(
      new URLSearchParams(window.location.search).get("tenant") || "",
    );
    setPortalTenant(q || getDefaultLabelPrefix());
  }, []);

  const effectiveUsername =
    accountPick === MANUAL_SENTINEL
      ? manualAccount.trim()
      : accountPick.trim();

  useEffect(() => {
    setSession(getSessionUser());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void (async () => {
      setIdentitiesLoading(true);
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      try {
        const res = await fetch(
          `${origin}/api/auth/management-login-identities?tenant=${encodeURIComponent(
            portalTenant,
          )}`,
        );
        const j = (await res.json().catch(() => ({}))) as {
          usernames?: string[];
          error?: string;
        };
        if (!cancelled && res.ok && Array.isArray(j.usernames)) {
          setUsernames(sortUsernames(j.usernames)); // 確保 API 回傳也套用排序[cite: 5]
          setIdentitiesLoading(false);
          return;
        }
      } catch {
        void 0;
      }
      const fallback = await loadUsernamesClientFallback(portalTenant);
      if (!cancelled) {
        setUsernames(fallback);
        setIdentitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, portalTenant]);

  useEffect(() => {
    if (!hydrated || !session) return;
    router.replace(postLoginRedirectPath(session.role));
  }, [hydrated, router, session]);

  const submitLogin = useCallback(async () => {
    if (!effectiveUsername || !password.trim()) {
      setMsg("請選擇或輸入帳號並填寫密碼");
      return;
    }
    setBusy(true);
    setMsg(null);
    const result = await loginUnifiedByPassword(
      supabase,
      effectiveUsername,
      password,
      portalTenant,
    );
    setBusy(false);
    if (!result.ok) {
      setMsg(result.message);
      return;
    }
    if ("kind" in result && result.kind === "unit") {
      router.replace(`/unit/${encodeURIComponent(result.slug)}`);
      return;
    }
    if ("user" in result) {
      setSession(result.user);
    }
  }, [effectiveUsername, password, router, supabase, portalTenant]);

  const logout = useCallback(() => {
    clearSessionUser();
    setSession(null);
  }, []);

  if (!hydrated) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-white text-sm font-black text-slate-600">
        載入中…
      </main>
    );
  }

  if (session) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-white px-4">
        <p className="text-sm font-black text-slate-700">正在前往工作台…</p>
        <button
          type="button"
          onClick={logout}
          className="text-xs font-bold text-slate-500 underline"
        >
          取消並登出
        </button>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-white">
      <header className="border-b border-slate-200 bg-white px-4 py-3 text-center shadow-sm sm:py-4">
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          AI 智能 QR 管理系統
        </h1>
        <p className="mt-2 text-sm font-semibold text-slate-600 sm:text-base">
          {APP_BRAND_TAGLINE}
        </p>
        <p className="mt-2 text-[11px] font-black tracking-tight text-blue-700 sm:text-xs">
          {APP_VERSION}
        </p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-start px-4 pb-10 pt-8 sm:pt-16">
        <div className="w-full max-w-md space-y-6">
          <h2 className="text-center text-3xl font-black text-slate-800">
            登入
          </h2>
          
          {/* 已刪除提示文字與租戶環境顯示[cite: 5] */}

          <div className="space-y-4 rounded-3xl border border-slate-200/90 bg-[#F8FAFC] p-6 shadow-sm sm:p-8">
            <label className="block w-full min-w-0 text-xs font-black text-slate-600">
              帳號
              <select
                className="mt-2 box-border h-14 w-full min-w-0 max-w-full rounded-2xl border border-slate-300 bg-white px-4 py-2 text-lg font-bold leading-normal text-slate-900 shadow-sm outline-none focus:border-blue-500 transition-all"
                value={accountPick}
                onChange={(e) => {
                  const v = e.target.value;
                  setAccountPick(v);
                  if (v !== MANUAL_SENTINEL) setManualAccount("");
                }}
                disabled={identitiesLoading}
              >
                <option value="">
                  {identitiesLoading ? "載入帳號清單中…" : "請選擇帳號"}
                </option>
                {usernames.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
                <option value={MANUAL_SENTINEL}>其他（手動輸入）</option>
              </select>
            </label>

            {accountPick === MANUAL_SENTINEL ? (
              <label className="block w-full min-w-0 text-xs font-black text-slate-600">
                手動輸入帳號
                <input
                  className="mt-2 box-border h-14 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 text-lg font-bold text-slate-900 shadow-sm outline-none focus:border-blue-500 transition-all"
                  placeholder="輸入帳號"
                  value={manualAccount}
                  onChange={(e) => setManualAccount(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                />
              </label>
            ) : null}

            <label className="block text-xs font-black text-slate-600">
              密碼
              <input
                className="mt-2 h-14 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg font-bold text-slate-900 shadow-sm outline-none focus:border-blue-500 transition-all"
                placeholder="密碼"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>

            <button
              type="button"
              onClick={() => void submitLogin()}
              disabled={busy || !effectiveUsername.trim()}
              className="mt-4 h-14 w-full rounded-2xl bg-blue-700 text-lg font-black text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "登入中…" : "登入"}
            </button>
          </div>

          {msg ? (
            <div className="rounded-2xl bg-red-50 p-4 text-center text-sm font-black text-red-800 ring-1 ring-red-200 shadow-sm">
              {msg}
            </div>
          ) : null}

          <p className="pt-4 text-center text-[10px] font-bold text-slate-400">
            <Link href="/super-admin/login" className="underline hover:text-slate-600 transition-colors">
              平台 Super Admin 總控台
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}