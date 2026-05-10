"use client";

import Link from "next/link";
import useSWR from "swr";
import { appHref } from "@/lib/appHref";

type TxRow = {
  id?: string;
  created_at?: string;
  operator_name?: string;
  order_no?: string;
  item_no?: string;
  action_type?: string;
  quantity_delta?: number;
  [k: string]: unknown;
};

const fetcher = async (url: string): Promise<TxRow[]> => {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as {
    rows?: TxRow[];
    error?: string;
  };
  if (!r.ok) throw new Error(j.error || "讀取失敗");
  return Array.isArray(j.rows) ? j.rows : [];
};

function actionText(v: string): string {
  if (v === "pick") return "領料";
  if (v === "return") return "退料";
  return v || "-";
}

export default function OperatorTransactionsPage() {
  const { data = [], error, isLoading, mutate } = useSWR<TxRow[]>(
    "/api/inventory/transactions",
    fetcher,
    {
      revalidateOnFocus: true,
      refreshInterval: 30_000,
    },
  );

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col gap-4 bg-[#F8FAFC] px-4 pb-10 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <Link
            href={appHref("/operator")}
            className="rounded-lg px-2 py-1 text-xl font-black text-slate-700 hover:bg-slate-100"
          >
            ←
          </Link>
          <h1 className="text-lg font-black text-slate-900">領退紀錄</h1>
          <button
            type="button"
            onClick={() => void mutate()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white"
          >
            重新整理
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow">
        {isLoading ? (
          <p className="text-sm font-bold text-slate-500">讀取中...</p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm font-black text-red-700">
            讀取失敗：{error.message}
          </p>
        ) : null}
        {!isLoading && !error && data.length === 0 ? (
          <p className="text-sm font-bold text-slate-500">目前無領退紀錄。</p>
        ) : null}

        <div className="space-y-2">
          {data.map((row, idx) => (
            <article
              key={String(row.id ?? `${idx}-${row.created_at ?? ""}`)}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <p className="text-xs font-bold text-slate-500">
                {row.created_at
                  ? new Date(String(row.created_at)).toLocaleString("zh-TW", {
                      hour12: false,
                    })
                  : "-"}
              </p>
              <p className="text-sm font-black text-slate-900">
                作業員：{String(row.operator_name ?? "-")}
              </p>
              <p className="text-sm font-bold text-slate-800">
                單號：{String(row.order_no ?? "-")} ｜ 料號：
                {String(row.item_no ?? "-")}
              </p>
              <p className="text-sm font-black text-slate-900">
                類型：{actionText(String(row.action_type ?? ""))} ｜ 異動量：
                {Number(row.quantity_delta ?? 0)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
