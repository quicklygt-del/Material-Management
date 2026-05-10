"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { appHref } from "@/lib/appHref";

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/super-admin/session");
        const j = (await r.json()) as { authenticated?: boolean };
        if (j.authenticated) router.replace(appHref("/super-admin"));
      } catch {
        void 0;
      }
    })();
  }, [router]);

  const submit = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error || "登入失敗");
        return;
      }
      router.replace(appHref("/super-admin"));
    } catch {
      setMsg("連線失敗");
    } finally {
      setBusy(false);
    }
  }, [password, router, username]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-black tracking-tight text-white">
        Super Admin 登入
      </h1>
      <p className="mt-2 text-xs font-bold leading-relaxed text-slate-400">
        獨立於一般後台；僅服務端環境變數帳密＋ HttpOnly Cookie JWT。
      </p>

      <div className="mt-8 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
        <label className="block text-xs font-black text-slate-300">
          帳號
          <input
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-bold text-white"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="block text-xs font-black text-slate-300">
          密碼
          <input
            type="password"
            className="mt-1.5 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-bold text-white"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="h-11 w-full rounded-lg bg-amber-400 text-sm font-black text-slate-950 disabled:opacity-50"
        >
          {busy ? "登入中…" : "登入總控"}
        </button>
        {msg ? (
          <p className="rounded-lg bg-red-950/80 p-2 text-center text-sm font-bold text-red-200 ring-1 ring-red-800">
            {msg}
          </p>
        ) : null}
      </div>

      <Link
        href={appHref("/")}
        className="mt-8 text-center text-xs font-bold text-slate-500 underline"
      >
        回到門戶首頁
      </Link>
    </main>
  );
}
