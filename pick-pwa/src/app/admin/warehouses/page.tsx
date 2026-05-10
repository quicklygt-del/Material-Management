"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
import { canAccessWarehouseDashboard, getSessionUser } from "@/lib/auth";
import { appHref } from "@/lib/appHref";
import { APP_VERSION } from "@/lib/version";

const MAX_W = 5;

type WarehouseRow = {
  id: string;
  name: string;
  created_at: string;
};

export default function AdminWarehousesPage() {
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<WarehouseRow[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    const user = getSessionUser();
    if (!user || !canAccessWarehouseDashboard(user.role)) {
      setMsg("僅倉儲主管可進入資產分頁設定。");
      return;
    }
    setReady(true);
    setMsg(null);
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouses");
      const json = (await res.json()) as {
        warehouses?: WarehouseRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `讀取失敗 ${res.status}`);
      setRows(json.warehouses ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void load();
  }, [ready, load]);

  const createWarehouse = async () => {
    const name = newName.trim();
    if (!name) {
      setMsg("名稱必填");
      return;
    }
    if (rows.length >= MAX_W) {
      setMsg(`單一企業環境最多 ${MAX_W} 個分頁`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "新增失敗");
      setNewName("");
      await load();
      setMsg("OK");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (id: string) => {
    const name = editName.trim();
    if (!name) {
      setMsg("名稱不可為空");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "更新失敗");
      setEditingId(null);
      await load();
      setMsg("OK");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("確定刪除此資產分頁？若有庫存異動紀錄則可能無法刪除。"))
      return;
    setBusy(true);
    setMsg(null);
    try {
      const u = new URL("/api/warehouses", window.location.origin);
      u.searchParams.set("id", id);
      const res = await fetch(u.toString(), { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "刪除失敗");
      await load();
      setMsg("OK");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  const canAdd = rows.length < MAX_W;

  return (
    <main
      aria-busy={busy}
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 p-6"
    >
      <WarehouseSupervisorNav />
      <header className="flex items-center justify-between">
        <div>
          <AppBrandHeader section="資產分頁設定" align="left" />
          <p className="mt-2 text-xs font-black text-blue-700">版本：{APP_VERSION}</p>
        </div>
        <Link href={appHref("/admin")} className="font-bold underline">
          回管理後台
        </Link>
      </header>

      {msg && (
        <div className="rounded-xl bg-slate-900 p-4 font-black text-white">{msg}</div>
      )}

      {ready && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => void load()}
              className="min-h-[46px] rounded-lg bg-slate-700 px-4 font-black text-white disabled:opacity-50"
            >
              重新載入列表
            </button>
          </div>

          <section className="rounded-xl bg-white p-4 shadow ring-1 ring-slate-200">
            <h2 className="text-xl font-black">新增分頁</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <input
                className="min-h-[48px] min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 font-bold"
                placeholder=""
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={!canAdd || busy}
              />
              <button
                type="button"
                disabled={!canAdd || busy}
                onClick={() => void createWarehouse()}
                className="min-h-[48px] rounded-lg bg-emerald-600 px-5 font-black text-white disabled:opacity-40"
              >
                {canAdd ? "建立" : `已達 ${MAX_W} 筆`}
              </button>
            </div>
          </section>

          <section className="rounded-xl bg-[#F0F4F8] p-4 shadow-inner ring-1 ring-slate-200/80">
            <h2 className="text-xl font-black text-slate-800">分頁列表（{rows.length}/{MAX_W}）</h2>
            <div className="mt-4 overflow-x-auto rounded-lg bg-white p-2">
              <table className="min-w-full text-left text-sm font-bold">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 pr-3">名稱</th>
                    <th className="py-3 pr-3">建立時間</th>
                    <th className="py-3 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.id} className="border-b border-slate-100">
                      <td className="py-3 pr-3">
                        {editingId === w.id ? (
                          <input
                            className="min-h-[44px] w-full rounded border border-slate-300 px-2"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        ) : (
                          w.name
                        )}
                      </td>
                      <td className="py-3 pr-3 font-mono text-xs text-slate-600">
                        {w.created_at
                          ? new Date(w.created_at).toLocaleString("zh-TW")
                          : "—"}
                      </td>
                      <td className="py-3 pr-3">
                        {editingId === w.id ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded bg-blue-600 px-3 py-2 text-white"
                              onClick={() => void saveRename(w.id)}
                              disabled={busy}
                            >
                              儲存
                            </button>
                            <button
                              type="button"
                              className="rounded bg-slate-200 px-3 py-2"
                              onClick={() => setEditingId(null)}
                              disabled={busy}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded bg-blue-600 px-3 py-2 text-white"
                              onClick={() => {
                                setEditingId(w.id);
                                setEditName(w.name);
                              }}
                              disabled={busy}
                            >
                              重新命名
                            </button>
                            <button
                              type="button"
                              className="rounded bg-red-600 px-3 py-2 text-white"
                              onClick={() => void remove(w.id)}
                              disabled={busy}
                            >
                              刪除
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && !busy && (
                <p className="mt-4 text-center font-semibold text-slate-500">—</p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
