"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { exitToLoginHome, loginByPassword } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { appHref } from "@/lib/appHref";

export default function AdminLoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <main className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-purple-50 to-white px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <button
          type="button"
          onClick={() => exitToLoginHome(router)}
          className="mb-6 block text-left text-sm font-bold text-purple-800 underline"
        >
          ← 回首頁
        </button>
        <h1 className="text-2xl font-black text-purple-950">系統管理員登入</h1>
        <p className="mt-2 text-sm font-semibold text-purple-950/85">
          帳號固定為 admin，請輸入管理員密碼。
        </p>
        <div className="mt-6 space-y-3 rounded-2xl border border-purple-100 bg-white p-5 shadow-sm">
          <input
            className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold text-slate-600"
            readOnly
            value="admin"
          />
          <input
            className="h-12 w-full rounded-xl border border-slate-300 px-4 text-base font-bold text-slate-900"
            placeholder="管理員密碼"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            className="h-12 w-full rounded-xl bg-purple-700 text-base font-black text-white shadow-md disabled:opacity-40"
            onClick={() => {
              void (async () => {
                setBusy(true);
                setMsg(null);
                const result = await loginByPassword(supabase, "admin", password);
                setBusy(false);
                if (!result.ok) {
                  setMsg(result.message);
                  return;
                }
                router.replace(appHref("/admin/other-operations"));
              })();
            }}
          >
            {busy ? "驗證中…" : "進入系統後台"}
          </button>
          {msg ? (
            <div className="rounded-xl bg-red-50 p-3 text-center text-xs font-black text-red-800 ring-1 ring-red-100">
              {msg}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
