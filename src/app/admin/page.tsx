"use client";

import React, { useState, useEffect } from "react";
import supabase from "@/lib/supabase"; 
import * as XLSX from "xlsx";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
// 引入登出與清理邏輯[cite: 2]
import { clearSessionUser } from "@/lib/auth"; 

export default function AdminCommandCenter() {
  const [warehouseUsers, setWarehouseUsers] = useState<any[]>([]); 
  const [tasks, setTasks] = useState<any[]>([]); 
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"loading" | "online" | "offline">("loading");
  
  // 篩選器狀態
  const [filterUser, setFilterUser] = useState<string>("全部");
  const [filterStatus, setFilterStatus] = useState<string>("全部");
  const [filterType, setFilterType] = useState<string>("全部");

  // 1. 同步人員名單邏輯 (修正選單空白)
  const fetchUsers = async () => {
    try {
      if (!supabase) return;
      const { data, error } = await supabase.from("warehouse_users").select("name, id");
      if (error) throw error;
      if (data) {
        setWarehouseUsers(data);
        setConnectionStatus("online");
      }
    } catch (err) {
      console.error("連線失敗:", err);
      setConnectionStatus("offline");
    }
  };

  useEffect(() => {
    fetchUsers();
    // 讀取暫存的任務資料[cite: 3]
    const savedTasks = localStorage.getItem("rmc_task_final");
    if (savedTasks) setTasks(JSON.parse(savedTasks));
  }, []);

  useEffect(() => {
    localStorage.setItem("rmc_task_final", JSON.stringify(tasks));
  }, [tasks]);

  // 處理返回系統入口並登出[cite: 2]
  const handleBackToLogin = () => {
    clearSessionUser(); // 清除本地 Session，防止 page_3.tsx 自動彈回[cite: 2]
    window.location.href = "/"; // 強制跳轉回根目錄入口[cite: 2]
  };

  // 2. Excel 匯入與單號辨識
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
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
    reader.readAsBinaryString(file);
  };

  const filteredTasks = tasks.filter(t => {
    const matchUser = filterUser === "全部" || t.assignedTo === filterUser;
    const matchStatus = filterStatus === "全部" || t.status === filterStatus;
    const matchType = filterType === "全部" || t.type === filterType;
    return matchUser && matchStatus && matchType;
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* 頂部導覽列：修正跳回門戶路徑[cite: 3] */}
      <nav className="bg-white px-6 py-3 shadow-sm border-b flex justify-between items-center">
        <div className="flex gap-8 items-center font-bold">
          {/* 修改點：改用按鈕觸發 handleBackToLogin[cite: 2] */}
          <button 
            onClick={handleBackToLogin}
            className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition-colors bg-transparent border-none cursor-pointer p-0"
          >
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
            {connectionStatus === 'online' ? `資料庫已連線 (人員:${warehouseUsers.length})` : '資料庫連線中...'}
          </div>
          <button onClick={fetchUsers} className="text-[10px] border px-2 py-1 rounded hover:bg-slate-50 font-bold text-slate-400">強制同步</button>
        </div>
      </nav>

      <main className="p-8 max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-end">
          <h1 className="text-3xl font-black text-slate-900 italic tracking-tighter">指揮塔：任務監控面板</h1>
        </div>

        {/* 1. 檔案匯入區[cite: 3] */}
        <section className="bg-slate-900 rounded-3xl p-8 text-white shadow-2xl flex items-center justify-between border-4 border-white">
          <div className="flex items-center gap-5">
            <div className="bg-blue-600 p-4 rounded-2xl shadow-lg font-black text-2xl">UP</div>
            <div>
              <h2 className="text-xl font-bold">匯入任務單 (Excel)</h2>
              <p className="text-slate-400 text-sm">系統將自動分析單號並生成作業任務</p>
            </div>
          </div>
          <div className="relative">
             <input type="file" onChange={handleExcelUpload} className="text-sm text-slate-400 file:mr-4 file:py-2.5 file:px-8 file:rounded-full file:border-0 file:bg-blue-600 file:text-white file:font-black cursor-pointer hover:file:bg-blue-500 transition-all" />
          </div>
        </section>

        {/* 2. 管理看板[cite: 3] */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="p-6 bg-slate-50 border-b space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-3 items-center">
                 <h3 className="text-lg font-black text-slate-800">當前任務看板</h3>
                 {(filterUser !== "全部" || filterStatus !== "全部") && (
                   <button onClick={() => {setFilterUser("全部"); setFilterStatus("全部");}} className="text-xs bg-blue-100 text-blue-600 px-3 py-1 rounded-full font-bold hover:bg-blue-200">✕ 清除篩選</button>
                 )}
              </div>
              <button 
                onClick={() => {if(confirm("清除已完成任務？")) setTasks(tasks.filter(t => t.status !== "完成"))}}
                className="bg-rose-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-rose-700 shadow-md transition-all"
              >
                清除今日完成
              </button>
            </div>
            
            {/* 篩選控制器[cite: 3] */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-white p-5 rounded-2xl border border-slate-100 shadow-inner">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">倉管員負載篩選</label>
                <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className="w-full text-sm p-3 rounded-xl border-2 border-slate-50 bg-slate-50 font-bold focus:border-blue-500 outline-none transition-all">
                  <option value="全部">全部人員 (查看總負荷)</option>
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

          {/* 任務列表[cite: 3] */}
          <div className="divide-y divide-slate-100 min-h-[400px]">
            {filteredTasks.length > 0 ? filteredTasks.map(t => (
              <div key={t.id} className="p-6 hover:bg-blue-50/20 transition-all">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-5">
                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black text-white shadow-sm ${
                      t.type === '入庫' ? 'bg-blue-500' : t.type === '檢貨' ? 'bg-emerald-500' : 'bg-purple-500'
                    }`}>
                      {t.type}
                    </div>
                    <div className="cursor-pointer group" onClick={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}>
                      <h4 className="font-black text-slate-800 text-lg group-hover:text-blue-600 transition-colors underline decoration-slate-200 underline-offset-4">{t.orderNo}</h4>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 font-bold">{t.items.length} 項目</span>
                        <span className="text-[10px] text-blue-500 font-black">{expandedTaskId === t.id ? "收起明細 ▲" : "查看明細 ▼"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-10">
                    {/* 人員分配區[cite: 3] */}
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-black text-slate-300 uppercase">執行人員</span>
                      {t.status === "未派單" ? (
                        <select 
                          onChange={(e) => {
                            if(e.target.value) {
                              setTasks(tasks.map(x => x.id === t.id ? { ...x, assignedTo: e.target.value, status: "未進行" } : x));
                            }
                          }}
                          className="text-xs border-2 border-amber-400 rounded-xl px-4 py-2 font-black bg-white shadow-sm hover:border-blue-500 outline-none transition-all cursor-pointer"
                        >
                          <option value="">⚠️ 選擇倉管員</option>
                          {warehouseUsers.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">{t.assignedTo}</span>
                          <button onClick={() => setTasks(tasks.map(x => x.id === t.id ? { ...x, assignedTo: "", status: "未派單" } : x))} className="text-[10px] text-slate-300 hover:text-rose-500 font-bold underline">重派</button>
                        </div>
                      )}
                    </div>

                    {/* 作業狀態區[cite: 3] */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[10px] font-black text-slate-300 uppercase">即時狀態</span>
                      <div className={`px-4 py-1.5 rounded-full text-[10px] font-black shadow-sm ${
                        t.status === '完成' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 
                        t.status === '進行中' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 
                        t.status === '未進行' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-100 text-slate-400'
                      }`}>
                        {t.status}
                      </div>
                    </div>

                    {/* 操作按鈕區[cite: 3] */}
                    <div className="flex gap-3">
                      {t.status !== "完成" && t.status !== "未派單" && (
                        <button 
                          onClick={() => setTasks(tasks.map(x => x.id === t.id ? { ...x, status: x.status === "未進行" ? "進行中" : "完成" } : x))} 
                          className="bg-slate-900 text-white text-[10px] px-4 py-2.5 rounded-xl font-black hover:bg-blue-600 transition-all"
                        >
                          模擬現場回報
                        </button>
                      )}
                      <button onClick={() => setTasks(tasks.filter(x => x.id !== t.id))} className="text-slate-300 hover:text-rose-600 p-2 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 明細展開區[cite: 3] */}
                {expandedTaskId === t.id && (
                  <div className="mt-6 p-6 bg-slate-50 rounded-2xl border-2 border-blue-50 shadow-inner grid grid-cols-1 md:grid-cols-4 gap-3">
                    {t.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 group-hover:border-blue-200 transition-all shadow-sm">
                        <span className="font-mono text-xs text-slate-500 font-bold">{item.partNo}</span>
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] text-slate-300">預計</span>
                           <span className="font-black text-blue-600 text-lg">{item.qty}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center p-32 text-slate-200">
                <div className="text-7xl mb-6 grayscale opacity-30">📋</div>
                <div className="font-black italic text-lg tracking-widest">目前暫無符合條件之單據</div>
                <p className="text-sm mt-1">請匯入 Excel 檔案或調整篩選條件</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}