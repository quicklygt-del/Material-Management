"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
import { canAccessWarehouseDashboard, getSessionUser } from "@/lib/auth";
import { parseExcelFirstSheet } from "@/lib/excelSheet";
import { getEffectiveTenantSlug } from "@/lib/tenantContext";
import { IMPORT_HEADER_GROUPS, normLedgerItemNo } from "@/lib/warehouseLedger";
import { APP_VERSION } from "@/lib/version";

type LedgerItem = {
  id: string;
  item_no: string;
  item_name: string;
  spec: string;
  on_hand: number;
};

type LedgerLine = {
  id: string;
  direction: string;
  qty_delta: number;
  balance_after: number;
  shortage_forced: boolean;
  ref: Record<string, unknown> | null;
  created_at: string;
};

function guessColIdx(
  labels: string[],
  needles: readonly string[],
): number {
  const n = (s: string) => s.replace(/\uFEFF/g, "").trim().toLowerCase();
  for (let i = 0; i < labels.length; i += 1) {
    const h = n(labels[i]);
    if (
      needles.some(
        (k) => h.includes(k) || k.toLowerCase() === h,
      )
    ) {
      return i;
    }
  }
  return -1;
}

export default function WarehouseLedgerAdminPage() {
  const tenant = useMemo(() => getEffectiveTenantSlug(), []);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [linesByItem, setLinesByItem] = useState<Record<string, LedgerLine[]>>(
    {},
  );
  const [loadingLines, setLoadingLines] = useState<Record<string, boolean>>(
    {},
  );
  const [qDraft, setQDraft] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [count, setCount] = useState(0);
  const excelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const u = getSessionUser();
    if (!u || !canAccessWarehouseDashboard(u.role)) {
      setMsg("僅倉儲主管可進入倉儲總帳。");
      return;
    }
    setReady(true);
    setMsg(null);
  }, []);

  const loadItems = useCallback(async () => {
    const u = new URL("/api/warehouse-ledger/items", window.location.origin);
    u.searchParams.set("tenant", tenant);
    u.searchParams.set("limit", "500");
    u.searchParams.set("offset", "0");
    if (qApplied.trim()) u.searchParams.set("q", qApplied.trim());
    const res = await fetch(u.toString());
    const json = (await res.json()) as {
      items?: LedgerItem[];
      count?: number;
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || "讀取失敗");
    setItems(json.items ?? []);
    setCount(json.count ?? 0);
  }, [tenant, qApplied]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadItems();
      } catch (e) {
        if (!cancelled) {
          setMsg(e instanceof Error ? e.message : "讀取失敗（請確認 DB 是否已套用 schema）");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, loadItems]);

  const toggleItem = async (itemNo: string) => {
    const key = itemNo;
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    if (linesByItem[key]?.length) return;

    setLoadingLines((o) => ({ ...o, [key]: true }));
    try {
      const u = new URL("/api/warehouse-ledger/lines", window.location.origin);
      u.searchParams.set("tenant", tenant);
      u.searchParams.set("item_no", itemNo);
      u.searchParams.set("limit", "80");
      const res = await fetch(u.toString());
      const json = (await res.json()) as { lines?: LedgerLine[]; error?: string };
      if (!res.ok) throw new Error(json.error || "讀取日誌失敗");
      setLinesByItem((o) => ({ ...o, [key]: json.lines ?? [] }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取日誌失敗");
    } finally {
      setLoadingLines((o) => ({ ...o, [key]: false }));
    }
  };

  const onImportExcel = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const sheet = await parseExcelFirstSheet(file);
      const labs = sheet.columnLabels;
      const idxItem = guessColIdx(labs, IMPORT_HEADER_GROUPS.item_no);
      const idxName = guessColIdx(labs, IMPORT_HEADER_GROUPS.item_name);
      const idxSpec = guessColIdx(labs, IMPORT_HEADER_GROUPS.spec);
      const idxQty = guessColIdx(labs, IMPORT_HEADER_GROUPS.on_hand);

      if (idxItem < 0 || idxQty < 0) {
        throw new Error("Excel 需可辨識「料號」與「現有總量／庫存」欄；請對照標題列。");
      }

      const rows: Record<string, unknown>[] = [];

      for (const r of sheet.dataRows) {
        const item_no = normLedgerItemNo(r[idxItem]);
        const onHandRaw = r[idxQty];
        const qty =
          typeof onHandRaw === "string"
            ? parseFloat(onHandRaw.replace(/,/g, "").trim())
            : Number(onHandRaw);
        const item_name =
          idxName >= 0 ? String(r[idxName] ?? "").trim() : "";
        const spec = idxSpec >= 0 ? String(r[idxSpec] ?? "").trim() : "";
        if (!item_no) continue;
        if (!Number.isFinite(qty)) continue;
        rows.push({
          item_no,
          item_name,
          spec,
          on_hand: Math.floor(qty),
        });
      }

      if (!rows.length) throw new Error("無有效列可匯入");

      let total = 0;
      const CHUNK = 1200;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const res = await fetch("/api/warehouse-ledger/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenant, rows: part }),
        });
        const json = (await res.json()) as { error?: string; upserted?: number };
        if (!res.ok) throw new Error(json.error || "上傳失敗");
        total += json.upserted ?? 0;
      }

      setMsg(`已批次匯入／更新 ${total} 筆料號主檔（總帳初始化）`);
      await loadItems();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      if (excelRef.current) excelRef.current.value = "";
    }
  };

  const downloadMoves = () => {
    const u = new URL("/api/warehouse-ledger/export", window.location.origin);
    u.searchParams.set("tenant", tenant);
    u.searchParams.set("scope", "lines");
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  const downloadStock = () => {
    const u = new URL("/api/warehouse-ledger/export", window.location.origin);
    u.searchParams.set("tenant", tenant);
    u.searchParams.set("scope", "stock");
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="min-h-screen bg-slate-100/80">
      <WarehouseSupervisorNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <AppBrandHeader section="倉儲總帳" align="left" />
            <p className="mt-1 text-xs font-black text-blue-800">
              版本：{APP_VERSION} · 租戶前綴{" "}
              <span className="font-mono">{tenant}</span>
            </p>
          </div>
          <Link href="/admin" className="font-bold text-blue-800 underline">
            回派單控制台
          </Link>
        </header>

        {msg && (
          <div
            className={`rounded-xl p-4 font-black text-white ${
              msg.includes("失敗") || msg.includes("僅") || msg.includes("確認")
                ? "bg-amber-700"
                : "bg-emerald-700"
            }`}
          >
            {msg}
          </div>
        )}

        {ready && (
          <>
            <section className="rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200">
              <h2 className="text-lg font-black text-slate-900">批次作業</h2>
              <p className="mt-1 text-xs font-semibold text-slate-600">
                欄位語意鍵：<code className="font-mono">item_no</code>、
                <code className="font-mono">item_name</code>、
                <code className="font-mono">spec</code>、
                <code className="font-mono">on_hand</code>
                （Excel 標頭支援中英別名，詳見程式{" "}
                <code className="font-mono">IMPORT_HEADER_GROUPS</code>）。
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center rounded-xl bg-blue-800 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                  <input
                    ref={excelRef}
                    type="file"
                    accept=".xlsx,.xls"
                    disabled={busy}
                    className="sr-only"
                    onChange={(e) =>
                      void onImportExcel(e.target.files?.[0] ?? null)
                    }
                  />
                  {busy ? "上傳中…" : "Excel 批量上傳（初始化／覆寫存量）"}
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => downloadMoves()}
                  className="rounded-xl border-2 border-slate-800 bg-white px-4 py-2.5 text-sm font-black text-slate-900 disabled:opacity-50"
                >
                  Excel 下載 · 異動紀錄（今日起）
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => downloadStock()}
                  className="rounded-xl border-2 border-slate-500 bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-800 disabled:opacity-50"
                >
                  Excel 下載 · 主檔存量
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadItems().catch((e) => setMsg(String(e)))}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"
                >
                  重新整理列表
                </button>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-sm font-black text-slate-800">
                  搜尋料號／品名
                  <input
                    className="min-h-[46px] w-64 max-w-full rounded-lg border border-slate-300 px-3 font-bold"
                    value={qDraft}
                    onChange={(e) => setQDraft(e.target.value)}
                    placeholder="輸入後按套用"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setQApplied(qDraft.trim());
                  }}
                  className="min-h-[46px] rounded-lg bg-slate-700 px-4 font-black text-white disabled:opacity-50"
                >
                  套用搜尋
                </button>
              </div>
              <p className="mt-2 text-xs font-bold text-slate-500">
                資料筆數（上限內）：{items.length}
                {count ? `／總筆數 ${count}` : ""}
              </p>

              <div className="mt-4 space-y-2">
                {items.map((it) => {
                  const open = expanded.has(it.item_no);
                  const lines = linesByItem[it.item_no] ?? [];
                  const loading = loadingLines[it.item_no];
                  const dirZh = (d: string) =>
                    d === "outbound" ? "出庫" : "入庫";
                  return (
                    <article
                      key={it.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/80"
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleItem(it.item_no)}
                        className="flex w-full items-center gap-3 px-3 py-3 text-left"
                      >
                        <span className="text-slate-500">{open ? "▼" : "▶"}</span>
                        <span className="min-w-0 flex-1 font-black text-slate-900">
                          <span className="font-mono text-[15px]">{it.item_no}</span>
                          <span className="ml-2 text-emerald-800">
                            現有總量 {it.on_hand}
                          </span>
                          {(it.item_name || it.spec) && (
                            <span className="mt-1 block truncate text-xs font-bold text-slate-600">
                              {it.item_name}
                              {it.spec ? ` · ${it.spec}` : ""}
                            </span>
                          )}
                        </span>
                      </button>

                      {open && (
                        <div className="border-t border-slate-200 bg-white px-3 py-2">
                          {loading ? (
                            <p className="py-4 text-center text-sm font-bold text-slate-500">
                              載入異動紀錄…
                            </p>
                          ) : lines.length === 0 ? (
                            <p className="py-2 text-xs font-bold text-slate-500">
                              尚無異動日誌
                            </p>
                          ) : (
                            <ul className="space-y-1 text-xs font-mono text-slate-800">
                              {lines.map((ln) => (
                                <li
                                  key={ln.id}
                                  className="flex flex-wrap gap-x-2 gap-y-1 border-b border-dashed border-slate-100 py-1 last:border-0"
                                >
                                  <span>{String(ln.created_at).replace("T", " ").slice(0, 19)}</span>
                                  <span className="font-black">
                                    ｜{dirZh(ln.direction)}｜變動
                                    {ln.direction === "outbound" ? "-" : "+"}
                                    {ln.qty_delta}
                                    ｜結存 {ln.balance_after}
                                    {ln.shortage_forced ? "｜強制放行" : ""}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!items.length && (
                  <p className="py-10 text-center font-bold text-slate-500">
                    尚無總帳資料 · 請先上方 Excel 初始化
                  </p>
                )}
              </div>
            </section>

            <p className="text-center text-[11px] font-semibold text-slate-500">
              DB 請執行：supabase/schema_warehouse_general_ledger.sql ·
              掃描異動係非同步調帳，節錄異動請用「異動紀錄」下載檔確認。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
