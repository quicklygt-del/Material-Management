"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import useSWR from "swr";
import {
  fetchTodayTasksGrouped,
  opTypeShortLabel,
  type WarehouseTaskGroup,
} from "@/lib/warehouseTasks";
import { getEffectiveTenantSlug } from "@/lib/tenantContext";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function WarehouseStyleTaskDeck({
  assignedOperator,
  titleSuffix = "",
  /** 單位頁：不顯示標籤中心大區塊與「自主發起掃描」 */
  compactForUnit = false,
}: {
  assignedOperator: string;
  /** 標題後綴，例如單位名稱 */
  titleSuffix?: string;
  compactForUnit?: boolean;
}) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const op = assignedOperator.trim();
  const tenant = getEffectiveTenantSlug();

  const fetchMyTasks = useCallback(async (): Promise<WarehouseTaskGroup[]> => {
    return fetchTodayTasksGrouped(supabase, op, tenant);
  }, [op, supabase, tenant]);

  const {
    data: myTasks = [],
    error: myTasksErr,
    isLoading: myTasksLoading,
    isValidating: myTasksRefreshing,
    mutate: reloadMyTasks,
  } = useSWR(op ? `my-tasks:${op}:${tenant}` : null, fetchMyTasks, {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 20_000,
  });

  if (!op) return null;

  return (
    <>
      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-black">
            我的今日任務{titleSuffix ? ` · ${titleSuffix}` : ""}
          </h2>
          <button
            type="button"
            onClick={() => void reloadMyTasks()}
            className="h-10 rounded-lg bg-slate-900 px-3 text-sm font-black text-white"
          >
            {myTasksRefreshing ? "更新中..." : "重新整理"}
          </button>
        </div>
        <div className="grid gap-2">
          {myTasksLoading &&
            myTasks.length === 0 &&
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="animate-pulse rounded-xl border border-slate-200 bg-slate-100 p-3"
              >
                <div className="h-5 w-2/3 rounded bg-slate-200" />
                <div className="mt-2 h-4 w-1/2 rounded bg-slate-200" />
              </div>
            ))}
          {myTasks.map((t) => (
            <button
              key={t.groupKey}
              type="button"
              onClick={() => {
                const q = new URLSearchParams({
                  orderKey: t.groupKey,
                  orderNo: t.order_no,
                });
                router.push(`/operate?${q.toString()}`);
              }}
              className="w-full rounded-xl border border-slate-300 bg-blue-50 p-3 text-left font-black"
            >
              <div className="text-slate-900">
                單號：{t.order_no}
                <span className="ml-1 text-base font-black text-slate-600">
                  （{t.types.map(opTypeShortLabel).join(" · ")}）
                </span>
              </div>
              <div className="text-sm text-slate-700">
                總數量：{t.required_qty} ｜ 進度：{t.picked_qty}/{t.required_qty}
                （{t.progress_pct}%）
              </div>
            </button>
          ))}
          {myTasksErr && (
            <p className="rounded-lg bg-red-50 p-3 font-bold text-red-700">
              今日任務讀取失敗：
              {myTasksErr instanceof Error ? myTasksErr.message : "未知錯誤"}
            </p>
          )}
          {!myTasksLoading && myTasks.length === 0 && !myTasksErr && (
            <p className="font-bold text-slate-500">
              今日已指派任務顯示於此（僅顯示派單給您帳號之單據）
            </p>
          )}
        </div>
        {!compactForUnit ? (
          <button
            type="button"
            onClick={() => router.push("/operate?op=manual")}
            className="mt-4 h-[58px] w-full rounded-xl bg-blue-700 text-xl font-black text-white"
          >
            ＋自主發起掃描
          </button>
        ) : null}
      </section>
    </>
  );
}
