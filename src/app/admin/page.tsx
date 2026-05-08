"use client";

import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
import { clearSessionUser } from "@/lib/auth";

// 取得全域 Supabase 客戶端
const getSupabase = () => {
  if (typeof window !== "undefined" && (window as any).supabase) {
    return (window as any).supabase;
  }
  return null;
};

export default function AdminCommandCenter() {
  const [warehouseUsers, setWarehouseUsers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "online" | "offline">("loading");

  const [filterUser, setFilterUser] = useState<string>("全部");
  const [filterStatus, setFilterStatus] = useState<string>("全部");
  const [filterType, setFilterType] = useState<string>("全部");

  // 修正後的抓取人員函式
  const fetchUsers = async (targetCompanyId: string) => {
    const supabaseClient = getSupabase();
    if (!supabaseClient) throw new Error("Supabase client not available");

    const { data, error } = await supabaseClient
      .from("warehouse_operators")
      .select("name, id, company_id") // 這裡由 tenant_id 改為 company_id
      .eq("company_id", targetCompanyId) // 這裡由 tenant_id 改為 company_id
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    setWarehouseUsers(data ?? []);
  };

  const initDashboard = async () => {
    try {
      setConnectionStatus("loading");
      const supabaseClient = getSupabase();
      if (!supabaseClient) {
        console.error("❌ window.supabase 不存在");
        setConnectionStatus("offline");
        return;
      }

      // 暫時將租戶 ID 寫死為 'CARB' 以進行測試
      const currentTenantId = "CARB";

      await fetchUsers(currentTenantId);
      setConnectionStatus("online");
    } catch (err) {
      console.error(err);
      setConnectionStatus("offline");
    }
  };

  useEffect(() => {
    initDashboard();
    const savedTasks = localStorage.getItem("rmc_task_final");
    if (savedTasks) setTasks(JSON.parse(savedTasks));
  }, []);

  useEffect(() => {
    localStorage.setItem("rmc_task_final", JSON.stringify(tasks));
  }, [tasks]);

  const handleBackToLogin = () => {
    clearSessionUser();
    window.location.href = "/";
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const raw: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      if (raw.length === 0) return;
      const orderNo = raw[0]["order_no (單號)"] || raw[0]["order_no"] || "未知單號";
      const items = raw.map((row: any) => ({
        partNo: row["item_no (料號)"] || row["item_no"],
        qty: row["required_qty (預計入庫)"] || row["required_qty"]
      }));
      let type = "其他";
      if (orderNo.startsWith("IN")) type = "入庫";
      else if (orderNo.startsWith("ab") || orderNo.startsWith("OUT")) type = "檢貨";
      else if (orderNo.startsWith("ST")) type = "盤單";
      setTasks(prev => [{
        id: Date.now(),
        orderNo,
        items,
        assignedTo: "",
        status: "未派單",
        type,
        createdAt: new Date().toLocaleString()
      }, ...prev]);
    };
    reader.readAsArrayBuffer(file);
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
            {connectionStatus === 'online' ? `已同步租戶資料 (人員:${warehouseUsers.length})` : '正在連接資料庫...'}
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
              <p className="text-slate-400 text-sm">手動強制 CARB 模式已啟動</p>
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
                  <option value="檢貨">檢貨</option>
                  <option value="盤單">盤單</option>
                </select>
              </div>
            </div>
          </div>
          <div className="divide-y divide-slate-100 min-h-[400px]">
            {filteredTasks.length > 0 ? filteredTasks.map(t => (
              <div key={t.id} className="p-6 hover:bg-blue-50/20 transition-all">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-5">
                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black text-white ${t.type === '入庫' ? 'bg-blue-500' : t.type === '檢貨' ? 'bg-emerald-500' : 'bg-purple-500'}`}>{t.type}</div>
                    <div className="cursor-pointer" onClick={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}>
                      <h4 className="font-black text-slate-800 text-lg underline decoration-slate-200 underline-offset-4">{t.orderNo}</h4>
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
                    {t.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200">
                        <span className="font-mono text-xs text-slate-500 font-bold">{item.partNo}</span>
                        <span className="font-black text-blue-600 text-lg">{item.qty}</span>
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
    </div>
  );
}