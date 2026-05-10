"use client";

import React, { useState, useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as importedSupabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
// 引入登出與清理邏輯
import { clearSessionUser } from "@/lib/auth";
import { appHref } from "@/lib/appHref";
import {
  deletePickingTasksForOrder,
  syncCommandTowerTasksToSupabase,
  type CommandTowerTask,
} from "@/lib/syncCommandTowerToPicking";

const INIT_RETRY_MAX = 5;
const INIT_RETRY_DELAY_MS = 500;

/**
 * 雙源初始化：優先使用 window.supabase，否則回退至模組匯入的 supabase 實例。
 */
function getActiveClient(): SupabaseClient | null {
  if (typeof window !== "undefined" && (window as unknown as { supabase?: SupabaseClient }).supabase) {
    return (window as unknown as { supabase: SupabaseClient }).supabase;
  }
  return importedSupabase ?? null;
}

type BoardTask = {
  id: string;
  orderNo: string;
  items: Array<{
    partNo?: string;
    qty?: number | string;
    itemName?: string;
    spec?: string;
    unit?: string;
  }>;
  assignedTo: string;
  status: string;
  type: string;
  createdAt?: string;
};

type TaskTypeUi = "入庫" | "領料/出庫" | "盤點";

function normalizeTaskTypeUi(raw: string): TaskTypeUi {
  const t = String(raw ?? "").trim();
  if (t === "入庫") return "入庫";
  if (t === "盤點" || t === "盤單") return "盤點";
  return "領料/出庫";
}

function inferTaskType(raw: string): TaskTypeUi | null {
  const s = raw.toUpperCase();
  if (/(^|[^A-Z])(IN)([^A-Z]|$)/.test(s)) return "入庫";
  if (/(^|[^A-Z])(OUT|AB)([^A-Z]|$)/.test(s)) return "領料/出庫";
  if (/(^|[^A-Z])(ST)([^A-Z]|$)/.test(s)) return "盤點";
  return null;
}

function taskTypeTagClass(type: string): string {
  const t = normalizeTaskTypeUi(type);
  if (t === "入庫") return "bg-emerald-500";
  if (t === "盤點") return "bg-orange-500";
  return "bg-blue-500";
}

function pickRequiredQty(row: Record<string, unknown>): number | null {
  const norm = (s: string) =>
    s
      .replace(/\uFEFF/g, "")
      .normalize("NFKC")
      .replace(/[()（）\[\]【】\s]/g, "")
      .toLowerCase();
  const isQtyKey = (k: string) => {
    const nk = norm(k);
    return (
      nk.includes("required_qty") ||
      nk.includes("target_qty") ||
      (nk.includes("預入庫") && (nk.includes("數") || nk.includes("qty"))) ||
      (nk.includes("需求") && (nk.includes("數") || nk.includes("量") || nk.includes("qty"))) ||
      (nk === "數量" || nk.endsWith("qty"))
    );
  };
  for (const [k, raw] of Object.entries(row)) {
    if (!isQtyKey(k)) continue;
    const n = Number(String(raw ?? "").replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  // 最後保底：若該列僅一個明顯正整數值，且非單號/料號欄，仍視為需求數
  for (const [k, raw] of Object.entries(row)) {
    const nk = norm(k);
    if (nk.includes("order") || nk.includes("單號") || nk.includes("item") || nk.includes("料號")) {
      continue;
    }
    const n = Number(String(raw ?? "").replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/** 僅「品名」；勿把「規格」欄混入（圖二為分欄） */
function pickItemName(row: Record<string, unknown>): string {
  const keys = [
    "品名",
    "品名規格",
    "item_name",
    "item_name (品名規格)",
    "material_name",
    "product_name",
  ];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

/** 「規格」獨欄 */
function pickSpec(row: Record<string, unknown>): string {
  const keys = ["規格", "spec", "specification", "尺寸", "型號"];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function pickUnit(row: Record<string, unknown>): string {
  const keys = ["單位", "unit", "uom", "unit_of_measure"];
  for (const k of keys) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

export default function AdminCommandCenter() {
  const [warehouseUsers, setWarehouseUsers] = useState<
    Array<{ id: string; name: string }>
  >([]); 
  const [tasks, setTasks] = useState<BoardTask[]>([]); 
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "online" | "offline">("loading");

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOrderNosRef = useRef<Set<string>>(new Set());
  const didFirstSyncRef = useRef(false);
  
  // 篩選器狀態
  const [filterUser, setFilterUser] = useState<string>("全部");
  const [filterStatus, setFilterStatus] = useState<string>("全部");
  const [filterType, setFilterType] = useState<string>("全部");
  const [importDraft, setImportDraft] = useState<{
    orderNo: string;
    items: Array<{
      partNo?: string;
      qty?: number | string;
      itemName?: string;
      spec?: string;
      unit?: string;
    }>;
    fileName: string;
  } | null>(null);
  const [importType, setImportType] = useState<TaskTypeUi>("領料/出庫");

  // 返回入口並登出（須先宣告供 initDashboard 使用）
  const handleBackToLogin = () => {
    clearSessionUser();
    window.location.href = appHref("/");
  };

  const fetchUsers = async () => {
    const supabaseClient = getActiveClient();
    if (!supabaseClient) {
      throw new Error("Supabase client not available");
    }

    const { data, error } = await supabaseClient
      .from("warehouse_operators")
      .select("name, id")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    setWarehouseUsers(
      (data ?? []) as Array<{ id: string; name: string }>,
    );
  };

  const fetchTaskBoard = async () => {
    const res = await fetch("/api/admin/task-board", { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as {
      tasks?: BoardTask[];
      error?: string;
    };
    if (!res.ok) throw new Error(j.error || "任務看板載入失敗");
    setTasks(j.tasks ?? []);
  };

  /** 初始化資料庫連線與看板資料 */
  const initDashboard = async () => {
    try {
      setConnectionStatus("loading");

      let supabaseClient: SupabaseClient | null = null;
      for (let attempt = 1; attempt <= INIT_RETRY_MAX; attempt++) {
        supabaseClient = getActiveClient();
        if (supabaseClient) {
          console.log(`Supabase 客戶端已就緒（第 ${attempt} 次連線嘗試成功）`);
          break;
        }
        if (attempt < INIT_RETRY_MAX) {
          console.log(
            `客戶端尚未可用，將於 ${INIT_RETRY_DELAY_MS}ms 後進行第 ${attempt + 1} 次連線嘗試（上限 ${INIT_RETRY_MAX} 次）`
          );
          await new Promise((r) => setTimeout(r, INIT_RETRY_DELAY_MS));
        }
      }

      if (!supabaseClient) {
        console.log(`已完成 ${INIT_RETRY_MAX} 次連線嘗試，將切換為離線狀態以便稍後使用重新連線`);
        setConnectionStatus("offline");
        return;
      }

      await fetchUsers();
      await fetchTaskBoard();
      setConnectionStatus("online");
    } catch (err) {
      console.log("儀表板初始化已記錄結果，目前已切換為離線模式，可點選重新連線再次嘗試", err);
      setConnectionStatus("offline");
    }
  };

  useEffect(() => {
    void initDashboard();
  }, []);

  /** 指揮塔變更時同步至 picking_tasks，供倉管員「我的今日任務」顯示 */
  useEffect(() => {
    if (connectionStatus !== "online") return;
    const client = getActiveClient();
    if (!client) return;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const nextOrders = new Set(
            tasks
              .map((t) => String((t as CommandTowerTask).orderNo ?? "").trim())
              .filter((o) => o.length > 0),
          );

          // 首次由 DB 載入看板時不回寫，避免覆蓋既有任務細節。
          if (!didFirstSyncRef.current) {
            didFirstSyncRef.current = true;
            prevOrderNosRef.current = nextOrders;
            return;
          }

          for (const prev of Array.from(prevOrderNosRef.current)) {
            if (!nextOrders.has(prev)) {
              await deletePickingTasksForOrder(client, prev);
            }
          }

          await syncCommandTowerTasksToSupabase(
            client,
            tasks as CommandTowerTask[],
          );

          prevOrderNosRef.current = nextOrders;
        } catch (e) {
          console.log(
            "指揮塔任務同步至資料庫時已記錄狀態，倉管員端可稍後重新整理查看",
            e,
          );
        }
      })();
    }, 450);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [tasks, connectionStatus]);

  // Excel 匯入與辨識邏輯
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const raw = XLSX.utils.sheet_to_json(
        wb.Sheets[wb.SheetNames[0]],
      ) as Record<string, unknown>[];
      if (raw.length === 0) return;

      const orderNo = String(
        raw[0]["order_no (單號)"] ?? raw[0]["order_no"] ?? "未知單號",
      ).trim();
      const items = raw
        .map((row: Record<string, unknown>) => {
          const qty = pickRequiredQty(row);
          return {
            partNo: String(row["item_no (料號)"] ?? row["item_no"] ?? "").trim(),
            qty: qty === null ? undefined : qty,
            itemName: pickItemName(row),
            spec: pickSpec(row),
            unit: pickUnit(row),
          };
        })
        .filter(
          (x) =>
            Boolean(x.partNo) &&
            x.qty != null &&
            Number.isFinite(Number(x.qty)) &&
            Number(x.qty) > 0,
        );
      if (items.length === 0) {
        alert("匯入失敗：找不到有效的需求數量欄位，請確認 Excel 含「required_qty/需求數/預入庫數量」。");
        return;
      }

      const guess = inferTaskType(`${file.name} ${orderNo}`);
      setImportDraft({ orderNo, items, fileName: file.name });
      setImportType(guess ?? "領料/出庫");
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmImportDraft = () => {
    if (!importDraft) return;
    setTasks((prev) => [
      {
        id: `${Date.now()}`,
        orderNo: importDraft.orderNo,
        items: importDraft.items,
        assignedTo: "",
        status: "未派單",
        type: importType,
        createdAt: new Date().toLocaleString(),
      },
      ...prev,
    ]);
    setImportDraft(null);
  };

  const filteredTasks = tasks.filter(t => {
    const matchUser = filterUser === "全部" || t.assignedTo === filterUser;
    const matchStatus = filterStatus === "全部" || t.status === filterStatus;
    const matchType = filterType === "全部" || t.type === filterType;
    return matchUser && matchStatus && matchType;
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <nav className="bg-white px-6 py-3 shadow-sm border-b flex justify-between items-center">
        <div className="flex gap-8 items-center font-bold">
          <button onClick={handleBackToLogin} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors bg-transparent border-none cursor-pointer p-0">
            <span className="text-xl">⬅️</span> 
            <span className="text-sm">返回系統入口</span>
          </button>
          <div className="h-5 w-[1px] bg-slate-200"></div>
          <WarehouseSupervisorNav />
        </div>

        <div className="flex items-center gap-4">
          <div className={`px-3 py-1 rounded-full text-[10px] font-black flex items-center gap-2 ${
            connectionStatus === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}>
            <span className={`w-2 h-2 rounded-full ${connectionStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
            {connectionStatus === 'online' ? `已同步資料庫 (人員:${warehouseUsers.length})` : '正在連接資料庫...'}
          </div>
          <button onClick={initDashboard} className="text-[10px] border px-2 py-1 rounded hover:bg-slate-50 font-bold text-slate-400">重新連線</button>
        </div>
      </nav>

      <main className="p-8 max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-black text-slate-900 italic tracking-tighter">指揮塔：任務監控面板</h1>

        <section className="bg-slate-900 rounded-3xl p-8 text-white shadow-2xl flex items-center justify-between border-4 border-white">
          <div className="flex items-center gap-5">
            <div className="bg-blue-600 p-4 rounded-2xl shadow-lg font-black text-2xl">UP</div>
            <div>
              <h2 className="text-xl font-bold">匯入任務單 (Excel)</h2>
              <p className="text-slate-400 text-sm">任務資料已改為資料庫直連</p>
            </div>
          </div>
          <input type="file" onChange={handleExcelUpload} className="text-sm text-slate-400 file:mr-4 file:py-2.5 file:px-8 file:rounded-full file:border-0 file:bg-blue-600 file:text-white file:font-black cursor-pointer hover:file:bg-blue-500 transition-all" />
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="p-6 bg-slate-50 border-b space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-slate-800">當前任務看板</h3>
              <button onClick={() => {if(confirm("清除已完成任務？")) setTasks(tasks.filter(t => t.status !== "完成"))}} className="bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-rose-700 shadow-md">清除今日完成</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white p-5 rounded-2xl border border-slate-100 shadow-inner">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">倉管員篩選</label>
                <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="w-full text-sm p-3 rounded-xl border-2 border-slate-50 bg-slate-50 font-bold focus:border-blue-500 outline-none transition-all">
                  <option value="全部">全部人員</option>
                  {warehouseUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">進度狀態</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full text-sm p-3 rounded-xl border-2 border-slate-50 bg-slate-50 font-bold outline-none">
                  <option value="全部">所有進度</option>
                  <option value="未派單">未派單</option>
                  <option value="未進行">未進行</option>
                  <option value="進行中">進行中</option>
                  <option value="完成">完成</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">工作類別</label>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full text-sm p-3 rounded-xl border-2 border-slate-50 bg-slate-50 font-bold outline-none">
                  <option value="全部">所有類別</option>
                  <option value="入庫">入庫</option>
                  <option value="領料/出庫">領料/出庫</option>
                  <option value="盤點">盤點</option>
                </select>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-100 min-h-[400px]">
            {filteredTasks.length > 0 ? filteredTasks.map(t => (
              <div key={t.id} className="p-6 hover:bg-blue-50/20 transition-all">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-5">
                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black text-white ${taskTypeTagClass(t.type)}`}>{normalizeTaskTypeUi(t.type)}</div>
                    <div className="cursor-pointer" onClick={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}>
                      <h4 className="font-black text-slate-800 text-lg underline decoration-slate-200 underline-offset-4 flex items-center gap-2">
                        <span>{t.orderNo}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black text-white ${taskTypeTagClass(t.type)}`}>[{normalizeTaskTypeUi(t.type)}]</span>
                      </h4>
                      <span className="text-xs text-slate-400 font-bold">{t.items.length} 項目 - {expandedTaskId === t.id ? "收起明細 ▲" : "查看明細 ▼"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-10">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-black text-slate-300">執行人員</span>
                      {t.status === "未派單" ? (
                        <select onChange={(e) => e.target.value && setTasks(tasks.map(x => x.id === t.id ? { ...x, assignedTo: e.target.value, status: "未進行" } : x))} className="text-xs border-2 border-amber-400 rounded-xl px-4 py-2 font-black bg-white cursor-pointer">
                          <option value="">⚠️ 選擇倉管員</option>
                          {warehouseUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-lg">{t.assignedTo}</span>
                          <button onClick={() => setTasks(tasks.map(x => x.id === t.id ? { ...x, assignedTo: "", status: "未派單" } : x))} className="text-[10px] text-slate-300 hover:text-rose-500 font-bold underline">重派</button>
                        </div>
                      )}
                    </div>

                    <div className={`px-4 py-1.5 rounded-full text-[10px] font-black ${t.status === '完成' ? 'bg-emerald-100 text-emerald-700' : t.status === '進行中' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{t.status}</div>
                    <button onClick={() => setTasks(tasks.filter(x => x.id !== t.id))} className="text-slate-300 hover:text-rose-600 p-2">✕</button>
                  </div>
                </div>

                {expandedTaskId === t.id && (
                  <div className="mt-6 p-6 bg-slate-50 rounded-2xl grid grid-cols-1 md:grid-cols-4 gap-3 shadow-inner">
                    {t.items.map((item, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 gap-3">
                        <div>
                          <span className="font-mono text-xs text-slate-500 font-bold">{item.partNo}</span>
                          {item.itemName ? (
                            <p className="text-xs font-bold text-slate-700">{item.itemName}</p>
                          ) : null}
                          {item.spec ? (
                            <p className="text-[11px] font-bold text-slate-600">規格：{item.spec}</p>
                          ) : null}
                          {item.unit ? (
                            <p className="text-[11px] font-black text-slate-500">單位：{item.unit}</p>
                          ) : null}
                        </div>
                        <span className="font-black text-blue-600 text-lg">
                          {item.qty}
                          {item.unit ? ` ${item.unit}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center p-32 text-slate-200">
                <div className="text-7xl mb-6 opacity-30">📋</div>
                <div className="font-black italic text-lg tracking-widest">目前暫無符合條件之單據</div>
              </div>
            )}
          </div>
        </section>
      </main>
      {importDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-black text-slate-900">確認匯入單據類型</h3>
            <p className="mt-2 text-sm font-bold text-slate-600">
              檔名：{importDraft.fileName} ｜ 單號：{importDraft.orderNo}
            </p>
            <p className="mt-1 text-xs font-bold text-rose-600">
              若自動判定有誤，請先手動修正類型再按「確認匯入」。
            </p>
            <div className="mt-4 grid gap-2">
              <label className="text-xs font-black text-slate-500">任務類型</label>
              <select
                value={importType}
                onChange={(e) => setImportType(normalizeTaskTypeUi(e.target.value))}
                className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-sm font-black outline-none focus:border-blue-500"
              >
                <option value="入庫">入庫</option>
                <option value="領料/出庫">領料/出庫</option>
                <option value="盤點">盤點</option>
              </select>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportDraft(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmImportDraft}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white"
              >
                確認匯入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}