"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { WarehouseStyleTaskDeck } from "@/components/warehouse/WarehouseStyleTaskDeck";
import {
  clearSessionUser,
  getSessionUser,
  normalizeRole,
} from "@/lib/auth";
import { withTenantParam } from "@/lib/tenantNav";
import { APP_VERSION } from "@/lib/version";

/**
 * 倉管員登入後工作台：今日派單（picking_tasks）→ 進入 /operate 掃描。
 * 登出回首頁可避免舊 /field「返回」與首頁自動導向造成的循環。
 */
export default function OperatorWorkbenchPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const u = getSessionUser();
    const role = normalizeRole(u?.role);
    if (!u || role !== "warehouse_staff") {
      router.replace(withTenantParam("/"));
      return;
    }
    setUsername(u.username);
  }, [router]);

  const exitToLogin = () => {
    clearSessionUser();
    router.replace(withTenantParam("/"));
  };

  if (!username) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-white text-sm font-black text-slate-600">
        驗證身分中…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col gap-4 bg-[#F8FAFC] px-4 pb-10 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="border-b border-slate-200 bg-white/90 pb-3 pt-1 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={exitToLogin}
            className="min-h-[44px] rounded-xl px-2 text-xl font-black text-slate-700 hover:bg-slate-100"
            aria-label="登出並回首頁"
          >
            ←
          </button>
          <div className="flex-1 min-w-0 text-center">
            <p className="truncate text-lg font-black text-slate-900">{username}</p>
            <h1 className="text-sm font-black text-slate-700">倉管員工作台</h1>
            <p className="text-[10px] font-bold text-blue-700">{APP_VERSION}</p>
          </div>
          <div className="w-10 shrink-0" aria-hidden />
        </div>
      </header>
      <WarehouseStyleTaskDeck assignedOperator={username} />
      <p className="text-center text-[11px] font-bold text-slate-500">
        需列印物料 QR？請由倉儲主管於標籤中心操作。
      </p>
    </main>
  );
}
