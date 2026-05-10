"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { appHref } from "@/lib/appHref";

type RegistryEntry = {
  numeric_code: string;
  public_slug: string;
  company_name: string;
  status: string;
  feature_warehouse_ledger: boolean;
  created_at: string;
};

export default function SuperAdminHomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setMsg(null);
    const r = await fetch("/api/super-admin/session");
    const s = (await r.json()) as { authenticated?: boolean };
    if (!s.authenticated) {
      router.replace(appHref("/super-admin/login"));
      return false;
    }

    const tr = await fetch("/api/super-admin/registry");
    if (!tr.ok) {
      const j = (await tr.json().catch(() => ({}))) as { error?: string };
      setMsg(j.error || "載入失敗");
      return true;
    }
    const tj = (await tr.json()) as { entries?: RegistryEntry[] };
    setEntries(tj.entries ?? []);
    return true;
  }, [router]);

  useEffect(() => {
    void (async () => {
      const ok = await reload();
      if (ok !== false) setReady(true);
    })();
  }, [reload]);

  const logout = async () => {
    await fetch("/api/super-admin/logout", { method: "POST" });
    router.replace(appHref("/super-admin/login"));
  };

  const onCreateEntry = async () => {
    const nm = companyName.trim();
    if (!nm) {
      setMsg("請輸入顯示名稱");
      return;
    }
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch("/api/super-admin/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_name: nm }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error || "新增失敗");
        return;
      }
      setCompanyName("");
      await reload();
    } catch {
      setMsg("連線失敗");
    } finally {
      setCreating(false);
    }
  };

  const toggleLedger = async (code: string, next: boolean) => {
    setMsg(null);
    const res = await fetch(
      `/api/super-admin/registry/${encodeURIComponent(code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_warehouse_ledger: next }),
      },
    );
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMsg(j.error || "更新失敗");
      return;
    }
    await reload();
  };

  const toggleStatus = async (code: string, active: boolean) => {
    setMsg(null);
    const res = await fetch(
      `/api/super-admin/registry/${encodeURIComponent(code)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: active ? "active" : "suspended",
        }),
      },
    );
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMsg(j.error || "更新失敗");
      return;
    }
    await reload();
  };

  if (!ready) {
    return (
      <main className="p-8">
        <p className="text-sm font-black text-slate-400">載入中…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Super Admin 總控</h1>
          <p className="mt-1 text-xs font-bold text-slate-400">
            平台註冊表（000–999）／倉儲總帳模組開關
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={appHref("/super-admin/label-templates")}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-black text-amber-300"
          >
            標籤格式公版
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-black text-slate-200"
          >
            登出
          </button>
        </div>
      </header>

      {msg ? (
        <div className="mt-4 rounded-xl border border-red-900/80 bg-red-950/40 p-3 text-sm font-bold text-red-200">
          {msg}
        </div>
      ) : null}

      <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h2 className="text-lg font-black text-amber-400">新增一筆</h2>
        <p className="mt-1 text-xs text-slate-400">
          系統自動發放 3 碼代碼與唯一公開 slug；建立後於後台設定登入帳號。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <input
            className="min-w-[12rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            placeholder="顯示名稱"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <button
            type="button"
            disabled={creating}
            onClick={() => void onCreateEntry()}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
          >
            {creating ? "建立中…" : "建立"}
          </button>
        </div>
      </section>

      <section className="mt-8 overflow-x-auto rounded-2xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900 font-black text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">代碼</th>
              <th className="px-3 py-2">公開 slug</th>
              <th className="px-3 py-2">名稱</th>
              <th className="px-3 py-2">狀態</th>
              <th className="px-3 py-2">倉儲總帳</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950/70">
            {entries.map((t) => (
              <tr key={t.numeric_code} className="font-semibold">
                <td className="px-3 py-2 font-mono text-amber-200">
                  {t.numeric_code}
                </td>
                <td className="px-3 py-2 font-mono text-sky-300">
                  {t.public_slug}
                </td>
                <td className="max-w-[10rem] truncate px-3 py-2 text-slate-200">
                  {t.company_name}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      void toggleStatus(
                        t.numeric_code,
                        t.status !== "active",
                      )
                    }
                    className={`rounded px-2 py-1 text-xs font-black ring-1 ${
                      t.status === "active"
                        ? "bg-emerald-950 text-emerald-200 ring-emerald-800"
                        : "bg-slate-800 text-slate-300 ring-slate-600"
                    }`}
                  >
                    {t.status === "active" ? "啟用" : "停用"}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      void toggleLedger(
                        t.numeric_code,
                        !t.feature_warehouse_ledger,
                      )
                    }
                    className={`rounded px-2 py-1 text-xs font-black ring-1 ${
                      t.feature_warehouse_ledger
                        ? "bg-sky-950 text-sky-200 ring-sky-800"
                        : "bg-slate-800 text-slate-400 ring-slate-600"
                    }`}
                  >
                    {t.feature_warehouse_ledger ? "開啟" : "關閉"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length ? (
          <p className="p-6 text-center text-xs text-slate-500">
            尚無資料；請確認資料庫已建立對應資料表與初始資料。
          </p>
        ) : null}
      </section>
    </main>
  );
}
