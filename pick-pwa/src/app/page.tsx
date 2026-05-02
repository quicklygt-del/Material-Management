"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { APP_BRAND_TAGLINE } from "@/components/AppBrandHeader";
import {
  clearSessionUser,
  fetchLoginIdentities,
  getSessionUser,
  loginByPassword,
  type SessionUser,
} from "@/lib/auth";
import { orderGroupKey } from "@/lib/pickingAgg";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

type OpType = "inbound" | "outbound" | "stocktake";

type MyTaskGroup = {
  /** 後台／作業頁與對齊：依單號彙總，同一單號僅一卡 */
  groupKey: string;
  order_no: string;
  types: OpType[];
  required_qty: number;
  picked_qty: number;
  progress_pct: number;
  representativeTaskId: string;
};

function normalizeOp(raw: unknown): OpType {
  const s = String(raw ?? "").trim();
  if (s === "inbound" || s === "stocktake") return s;
  return "outbound";
}

function opTypeShortLabel(op: OpType): string {
  if (op === "inbound") return "入庫";
  if (op === "stocktake") return "盤點";
  return "檢貨";
}

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(() =>
    getSessionUser(),
  );
  const [username, setUsername] = useState("admin");
  const [identityOptions, setIdentityOptions] = useState<string[]>(["admin"]);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const identities = await fetchLoginIdentities(supabase);
        if (!alive) return;
        setIdentityOptions(identities);
        setUsername((prev) => (identities.includes(prev) ? prev : "admin"));
      } catch (e) {
        if (!alive) return;
        setMsg(e instanceof Error ? e.message : "讀取人員清單失敗");
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [supabase]);

  useEffect(() => {
    if (session?.role === "admin") {
      router.replace("/admin/dashboard");
    }
  }, [router, session?.role]);

  const fetchMyTasks = useCallback(async (): Promise<MyTaskGroup[]> => {
    if (!session || session.role !== "warehouse") return [];
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
    ).toISOString();
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
    ).toISOString();
    const { data: tasks, error: tErr } = await supabase
      .from("picking_tasks")
      .select(
        "id,order_no,item_no,required_qty,operation_type,status,picking_logs(actual_qty)",
      )
      .eq("assigned_operator", session.username)
      .gte("created_at", start)
      .lt("created_at", end)
      .in("status", ["pending", "in_progress"])
      .order("created_at", { ascending: false });
    if (tErr) {
      throw new Error(tErr.message);
    }

    type Agg = {
      groupKey: string;
      order_no: string;
      typeSet: Set<OpType>;
      required_qty: number;
      picked_qty: number;
      representativeTaskId: string;
    };
    const byOrder = new Map<string, Agg>();
    for (const t of tasks ?? []) {
      const orderRaw = String(t.order_no ?? "");
      const groupKey = orderGroupKey(orderRaw);
      const req = Number(t.required_qty ?? 0);
      const pickedRow = Array.isArray((t as { picking_logs?: unknown[] }).picking_logs)
        ? ((t as { picking_logs?: Array<{ actual_qty?: number | null }> }).picking_logs ?? [])
            .reduce((s, lg) => s + (Number(lg.actual_qty) || 0), 0)
        : 0;
      const rowOp = normalizeOp(t.operation_type);
      const tid = String(t.id);
      const cur =
        byOrder.get(groupKey) ??
        ({
          groupKey,
          order_no: orderRaw.trim(),
          typeSet: new Set<OpType>(),
          required_qty: 0,
          picked_qty: 0,
          representativeTaskId: tid,
        } satisfies Agg);
      cur.required_qty += req;
      cur.picked_qty += pickedRow;
      cur.typeSet.add(rowOp);
      byOrder.set(groupKey, cur);
    }

    const mapped: MyTaskGroup[] = Array.from(byOrder.values()).map((g) => {
      const types = Array.from(g.typeSet);
      types.sort((a, b) => opTypeShortLabel(a).localeCompare(opTypeShortLabel(b)));
      const pct =
        g.required_qty > 0
          ? Math.min(100, Math.round((g.picked_qty / g.required_qty) * 100))
          : 0;
      return {
        groupKey: g.groupKey,
        order_no: g.order_no,
        types,
        required_qty: g.required_qty,
        picked_qty: g.picked_qty,
        progress_pct: pct,
        representativeTaskId: g.representativeTaskId,
      };
    });
    mapped.sort((a, b) => a.order_no.localeCompare(b.order_no));
    return mapped;
  }, [session, supabase]);

  const {
    data: myTasks = [],
    error: myTasksErr,
    isLoading: myTasksLoading,
    isValidating: myTasksRefreshing,
    mutate: reloadMyTasks,
  } = useSWR(
    session?.role === "warehouse" ? `my-tasks:${session.username}` : null,
    fetchMyTasks,
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      dedupingInterval: 20_000,
    },
  );

  const login = async () => {
    setBusy(true);
    setMsg(null);
    const result = await loginByPassword(supabase, username, password);
    setBusy(false);
    if (!result.ok) {
      setMsg(result.message);
      return;
    }
    setSession(result.user);
  };

  const logout = () => {
    clearSessionUser();
    setSession(null);
  };

  return (
    <>
      {!session ? (
        <main className="flex min-h-[100dvh] flex-col bg-white">
          <header className="border-b border-slate-200 bg-white px-4 py-3 text-center shadow-sm sm:py-4">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
              AI 智能 QR 管理系統
            </h1>
            <p className="mt-2 text-sm font-semibold text-slate-600 sm:text-base">
              {APP_BRAND_TAGLINE}
            </p>
            <p className="mt-2 text-[11px] font-black tracking-tight text-blue-700 sm:text-xs">
              {APP_VERSION}
            </p>
          </header>

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-stretch">
            <section className="flex flex-1 flex-col justify-start bg-[#F0F4F8] px-4 pb-5 pt-4 text-slate-900 lg:basis-0 lg:grow lg:justify-center lg:px-8 lg:py-8 lg:pb-10">
              <div className="mx-auto w-full max-w-md">
                <h2 className="text-center text-xl font-black tracking-tight text-slate-800 sm:text-2xl">
                  倉儲管理區
                </h2>
                <div className="mt-4 space-y-2.5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm sm:space-y-3 sm:p-5">
                  <select
                    className="h-12 w-full rounded-xl border border-slate-300 bg-[#FAFCFD] px-3 text-base font-bold text-slate-900 sm:h-14 sm:text-lg"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  >
                    {identityOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="h-12 w-full rounded-xl border border-slate-300 bg-[#FAFCFD] px-4 text-base font-bold text-slate-900 placeholder:text-slate-400 sm:h-14 sm:text-lg"
                    placeholder="密碼"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    onClick={() => void login()}
                    disabled={busy}
                    className="h-12 w-full rounded-xl bg-[#2563EB] text-base font-black text-white shadow-md transition-opacity disabled:opacity-40 sm:h-14 sm:text-lg"
                  >
                    {busy ? "登入中…" : "登入"}
                  </button>
                  {msg && (
                    <div className="rounded-xl bg-red-50 p-3 text-center text-sm font-black text-red-800 ring-1 ring-red-200">
                      {msg}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="flex flex-1 flex-col justify-start border-t border-slate-200/80 bg-gradient-to-b from-white to-emerald-50/50 px-4 pb-6 pt-4 lg:basis-0 lg:grow lg:border-l lg:border-t-0 lg:justify-center lg:px-8 lg:pb-10 lg:pt-8">
              <div className="mx-auto flex w-full max-w-md flex-col items-stretch">
                <h2 className="text-center text-xl font-black tracking-tight text-slate-800 sm:text-2xl">
                  其他作業區
                </h2>
                <Link
                  href="/field"
                  className="mt-4 flex min-h-[3rem] w-full items-center justify-center rounded-xl border border-emerald-500/70 bg-white px-4 py-3 text-center text-base font-black text-slate-800 shadow-sm transition-opacity active:opacity-95 sm:min-h-[3.25rem] sm:text-lg lg:mt-6"
                >
                  QR code 生成／掃描
                </Link>
              </div>
            </section>
          </div>
        </main>
      ) : (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-6">
      <header className="text-center">
        <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">
          AI 智能 QR 管理系統
        </h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          {APP_BRAND_TAGLINE}
        </p>
        <p className="mt-2 text-sm font-black text-blue-700">
          版本：{APP_VERSION}
        </p>
      </header>

      {session && session.role !== "admin" && (
        <>
          <div className="rounded-xl bg-emerald-600 p-4 text-lg font-black text-white">
            已登入：{session.username}（倉管員）
          </div>

          <section className="rounded-2xl border-4 border-indigo-300 bg-indigo-50 p-4 shadow-md">
            <h2 className="text-lg font-black text-indigo-950">標籤中心</h2>
            <p className="mt-1 text-sm font-semibold text-indigo-900">
              QR 標籤產製與藍牙列印（獨立於派單流程）。
            </p>
            <button
              type="button"
              onClick={() => router.push("/labels")}
              className="mt-4 min-h-[54px] w-full rounded-xl bg-indigo-700 text-lg font-black text-white shadow-md active:scale-[0.99]"
            >
              進入標籤中心
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-2xl font-black">我的今日任務</h2>
              <button
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
                    總數量：{t.required_qty} ｜ 進度：{t.picked_qty}/{t.required_qty}（
                    {t.progress_pct}%）
                  </div>
                </button>
              ))}
              {myTasksErr && (
                <p className="rounded-lg bg-red-50 p-3 font-bold text-red-700">
                  今日任務讀取失敗：{myTasksErr instanceof Error ? myTasksErr.message : "未知錯誤"}
                </p>
              )}
              {!myTasksLoading && myTasks.length === 0 && !myTasksErr && (
                <p className="font-bold text-slate-500">今日已指派任務顯示於此</p>
              )}
            </div>
            <button
              onClick={() => router.push("/operate?op=manual")}
              className="mt-4 h-[58px] w-full rounded-xl bg-blue-700 text-xl font-black text-white"
            >
              ＋自主發起掃描
            </button>
          </section>

          <button
            onClick={logout}
            className="h-[60px] w-full rounded-xl bg-slate-200 text-xl font-black text-slate-900"
          >
            登出
          </button>
        </>
      )}
    </main>
      )}
    </>
  );
}
