"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { APP_BRAND_TAGLINE } from "@/components/AppBrandHeader";
import { getDefaultLabelPrefix } from "@/lib/labelEncoding";
import { APP_VERSION } from "@/lib/version";

function OtherOperationsLoginInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const err = sp.get("err");
  const slugHint = sp.get("slug")?.trim();

  const tenant = useMemo(() => getDefaultLabelPrefix(), []);
  const [portalLogin, setPortalLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (slugHint && !portalLogin) {
      try {
        setPortalLogin(decodeURIComponent(slugHint));
      } catch {
        setPortalLogin(slugHint);
      }
    }
  }, [slugHint, portalLogin]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      if (!cancelled && res.ok) {
        const j = (await res.json()) as { slug?: string };
        const slug = j.slug?.trim();
        if (slug) {
          router.replace(`/unit/${encodeURIComponent(slug)}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const login = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/unit-portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tenant_id: tenant,
          portal_login: portalLogin.trim(),
          password,
        }),
      });
      const j = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) {
        setMsg(j.error ?? "登入失敗");
        return;
      }
      const slug = j.slug?.trim();
      if (!slug) {
        setMsg("未取得單位路徑");
        return;
      }
      router.replace(`/unit/${encodeURIComponent(slug)}`);
    } finally {
      setBusy(false);
    }
  }, [password, portalLogin, router, tenant]);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-emerald-50 to-white px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-block text-sm font-bold text-emerald-800 underline"
        >
          ← 回首頁
        </Link>
        <p className="text-[11px] font-black text-emerald-800">{APP_VERSION}</p>
        <h1 className="mt-2 text-2xl font-black text-emerald-950">
          🏢 其他作業區
        </h1>
        <p className="mt-2 text-sm font-semibold text-emerald-950/85">
          {APP_BRAND_TAGLINE}
        </p>
        <p className="mt-3 text-xs font-semibold text-emerald-900/90">
          請輸入管理員為您核發之單位帳密。登入後系統將依帳號自動對應所屬單位，並與倉儲區相同方式顯示今日派給該帳號之任務。
        </p>

        <div className="mt-6 space-y-3 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-14 w-full rounded-xl border border-zinc-300 px-4 font-bold outline-none ring-emerald-500 focus:ring-2"
            placeholder="單位帳號"
            value={portalLogin}
            onChange={(e) => setPortalLogin(e.target.value)}
          />
          <input
            type="password"
            className="h-14 w-full rounded-xl border border-zinc-300 px-4 font-bold outline-none ring-emerald-500 focus:ring-2"
            placeholder="密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void login()}
            className="h-14 w-full rounded-xl bg-emerald-700 text-lg font-black text-white disabled:opacity-40"
          >
            {busy ? "登入中…" : "登入並進入作業"}
          </button>
          {(msg || err === "forbidden") && (
            <p className="rounded-xl bg-red-50 p-3 text-center text-sm font-black text-red-800">
              {msg ??
                "無法存取此路徑，請使用正確帳號或改掃描邀請 QR。"}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function OtherOperationsLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm font-black text-emerald-950">
          載入…
        </div>
      }
    >
      <OtherOperationsLoginInner />
    </Suspense>
  );
}
