"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { appHref } from "@/lib/appHref";

type FlowRow = {
  id: string;
  item_no: string;
  po_no: string;
  item_name: string;
  current_stage: string;
  location_label: string;
  entered_at: string;
  updated_at: string;
};

type LedgerLine = {
  id: string;
  created_at: string;
  direction: string;
  qty_delta: number;
  balance_after: number;
  tx_type?: string | null;
  from_bin?: string | null;
  to_bin?: string | null;
  operator_name?: string | null;
};

function stageZh(s: string): string {
  const k = String(s ?? "").trim();
  if (k === "pending_inspect") return "待驗";
  if (k === "pending_putaway") return "倉庫-待上架";
  if (k === "stocked") return "已入庫";
  if (k === "pending_ship") return "待出貨";
  return k || "—";
}

function tsZh(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export default function FlowTrajectoryPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [row, setRow] = useState<FlowRow | null>(null);
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [linesErr, setLinesErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/inventory-flow/${encodeURIComponent(id)}`);
      const j = (await res.json()) as { flow?: FlowRow; error?: string };
      if (!alive) return;
      if (!res.ok) {
        setErr(j.error ?? "讀取失敗");
        return;
      }
      const fr = j.flow ?? null;
      setRow(fr);
      setLinesErr(null);
      setLines([]);
      if (fr?.item_no?.trim()) {
        const itemNo = fr.item_no.trim();
        const lr = await fetch(
          `/api/warehouse-ledger/lines?item_no=${encodeURIComponent(itemNo)}&limit=80`,
        );
        const lj = (await lr.json()) as {
          lines?: LedgerLine[];
          error?: string;
        };
        if (!alive) return;
        if (lr.ok) {
          setLines(lj.lines ?? []);
        } else {
          setLines([]);
          setLinesErr(lj.error ?? "無法載入總帳異動（請確認 warehouse_ledger_lines 與 item_no）");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (err) {
    return (
      <main className="min-h-screen bg-[#f8fafc] p-8 font-sans text-slate-800">
        <p className="text-xl font-bold text-red-700">{err}</p>
        <Link
          href={appHref("/dashboard")}
          className="mt-4 inline-block text-xl font-bold text-[#3b82f6] underline"
        >
          返回監控台
        </Link>
      </main>
    );
  }

  if (!row) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] font-sans text-xl font-bold text-slate-600">
        載入中…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] p-8 font-sans text-slate-800">
      <div className="mx-auto max-w-3xl">
        <Link
          href={appHref("/dashboard")}
          className="mb-6 inline-block text-xl font-bold text-[#3b82f6] underline"
        >
          ← 返回監控台
        </Link>
        <div className="rounded-[2rem] border border-slate-100 bg-white p-10 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">詳細異動軌跡</h1>
          <dl className="mt-8 space-y-4 text-xl">
            <div>
              <dt className="font-bold text-slate-500">料號</dt>
              <dd className="mt-1 font-bold">{row.item_no || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">PO 單號</dt>
              <dd className="mt-1 font-bold">{row.po_no || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">品項</dt>
              <dd className="mt-1 font-bold">{row.item_name || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">當前環節</dt>
              <dd className="mt-1 font-bold">{stageZh(row.current_stage)}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">位置</dt>
              <dd className="mt-1 font-bold">{row.location_label || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">進入環節時間</dt>
              <dd className="mt-1 font-mono font-bold">{row.entered_at}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-500">最後更新</dt>
              <dd className="mt-1 font-mono font-bold">{row.updated_at}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-8 rounded-[2rem] border border-slate-100 bg-white p-10 shadow-sm">
          <h2 className="text-3xl font-bold text-slate-900">總帳異動紀錄</h2>
          <p className="mt-2 text-xl text-slate-600">
            依料號自倉儲總帳匯總（不含 QR 儲位欄位）。
          </p>
          {linesErr ? (
            <p className="mt-6 text-xl font-bold text-amber-800">{linesErr}</p>
          ) : lines.length === 0 ? (
            <p className="mt-6 text-xl font-bold text-slate-500">
              尚無總帳異動資料
            </p>
          ) : (
            <ul className="mt-6 space-y-4">
              {lines.map((ln) => (
                <li
                  key={ln.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 p-5 text-xl"
                >
                  <div className="font-mono text-slate-500">
                    {tsZh(ln.created_at)}
                  </div>
                  <div className="mt-2 font-bold">
                    {ln.direction === "outbound" ? "出庫" : "入庫"} · 數量{" "}
                    {ln.direction === "outbound"
                      ? -Math.abs(ln.qty_delta)
                      : ln.qty_delta}{" "}
                    · 結餘 {ln.balance_after}
                  </div>
                  {(ln.from_bin || ln.to_bin) && (
                    <div className="mt-1 text-slate-600">
                      儲位 {ln.from_bin ?? "—"} → {ln.to_bin ?? "—"}
                    </div>
                  )}
                  {ln.operator_name ? (
                    <div className="mt-1 text-slate-600">
                      操作員 {ln.operator_name}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
