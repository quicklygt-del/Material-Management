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
 * 排序使用者名稱：admin 置頂，其餘按中文/英文字母排序
 */
function sortUsernames(usernames: string[]): string[] {
  const u = Array.from(
    new Set(usernames.map((x) => x.trim()).filter(Boolean)),
  );
  u.sort((a, b) => {
    if (a === "admin") return -1;
    if (b === "admin") return 1;
    return a.localeCompare(b, "zh-Hant");
  });
  return u;
}

/**
 * 當 API 無法使用時的客戶端備援方案
 * 統一使用 'company_id' 作為所有表格的過濾欄位
 */
async function loadUsernamesClientFallback(
  portalTenant: string,
): Promise<string[]> {
  const supabase = getSupabaseBrowserClient();
  const tenant =
    normalizeLabelPrefix(portalTenant) || getDefaultLabelPrefix();
  const seen = new Set<string>();

  // 1. 抓取系統帳號 (app_users) - 已移除角色限制
  const { data: appRows } = await supabase
    .from("app_users")
    .select("username")
    .eq("company_id", tenant);
  for (const row of appRows ?? []) {
    const x = String(row.username ?? "").trim();
    if (x) seen.add(x);
  }

  // 2. 抓取作業員 (warehouse_operators)
  const { data: opRows } = await supabase
    .from("warehouse_operators")
    .select("name")
    .eq("active", true)
    .eq("company_id", tenant);
  for (const row of opRows ?? []) {
    const x = String(row.name ?? "").trim();
    if (x) seen.add(x);
  }

  // 3. 抓取儲位區域登入帳號 (storage_zones)
  const { data: zoneRows } = await supabase
    .from("storage_zones")
    .select("portal_login")
    .eq("company_id", tenant);
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
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      try {
        // 優先嘗試後端 API
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
          setUsernames(j.usernames);
          setIdentitiesLoading(false);
          return;
        }
      } catch {
        void 0;
      }

      // 如果 API 失敗，執行 fallback 邏輯
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

      <div className="flex flex-1 flex-col items-center justify-start px-4 pb-10 pt-8 sm:pt-12">
        <div className="w-full max-w-md space-y-3">
          <h2 className="text-center text-xl font-black text-slate-800 sm:text-2xl">
            登入
          </h2>
          <p className="text-center text-xs font-semibold leading-relaxed text-slate-600">
            請選擇或輸入帳號，並輸入密碼登入。
          </p>
          <div className="space-y-2.5 rounded-2xl border border-slate-200/90 bg-[#F8FAFC] p-4 shadow-sm sm:space-y-3 sm:p-5">
            <label className="block w-full min-w-0 text-xs font-black text-slate-600">
              帳號
              <select
                className="mt-1.5 box-border h-12 w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-bold leading-normal text-slate-900 sm:h-14 sm:text-lg [&>option]:py-1"
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
                  className="mt-1.5 box-border h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-900 sm:h-14 sm:text-lg"
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
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base font-bold text-slate-900 sm:h-14 sm:text-lg"
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
              className="h-12 w-full rounded-xl bg-blue-700 text-base font-black text-white shadow-md transition-opacity disabled:opacity-40 sm:h-14 sm:text-lg"
            >
              {busy ? "登入中…" : "登入"}
            </button>
          </div>
          {msg ? (
            <div className="rounded-xl bg-red-50 p-3 text-center text-sm font-black text-red-800 ring-1 ring-red-200">
              {msg}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}