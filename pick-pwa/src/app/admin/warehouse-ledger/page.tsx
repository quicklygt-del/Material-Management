"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
import { canAccessWarehouseDashboard, getSessionUser } from "@/lib/auth";
import { parseExcelFirstSheet } from "@/lib/excelSheet";
import { appHref } from "@/lib/appHref";
import {
  buildLedgerQrPayloadNoBin,
  IMPORT_HEADER_GROUPS,
  normLedgerItemNo,
} from "@/lib/warehouseLedger";
import { APP_VERSION } from "@/lib/version";

type LedgerItem = {
  id: string;
  item_no: string;
  item_name: string;
  spec: string;
  on_hand: number;
  updated_at?: string;
};

type BinRow = { bin_code: string; qty: number; updated_at: string };

type LedgerLine = {
  id: string;
  direction: string;
  qty_delta: number;
  balance_after: number;
  shortage_forced: boolean;
  ref: Record<string, unknown> | null;
  created_at: string;
  tx_type?: string | null;
  from_bin?: string | null;
  to_bin?: string | null;
  operator_name?: string | null;
  bin_balance_after?: number | null;
};

const UI_LG = "text-[1.25rem] font-black";
const BTN_LG = "min-h-[52px] px-4 text-[1.25rem] font-black";

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

function fmtLineTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 19);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function txLabel(tx: string | null | undefined, direction: string): string {
  const t = String(tx ?? "").trim();
  if (t === "inbound" || t === "legacy_inbound") return "入庫";
  if (t === "outbound" || t === "legacy_outbound") return "出庫";
  if (t === "transfer") return "移庫";
  if (t === "stocktake") return "盤點";
  if (t === "special_issue") return "特殊領用";
  return direction === "outbound" ? "出庫" : "入庫";
}

export default function WarehouseLedgerAdminPage() {
  const session = useMemo(() => getSessionUser(), []);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [binsByItem, setBinsByItem] = useState<Record<string, BinRow[]>>({});
  const [binsDisabled, setBinsDisabled] = useState(false);
  const [linesByItem, setLinesByItem] = useState<Record<string, LedgerLine[]>>(
    {},
  );
  const [loadingDetail, setLoadingDetail] = useState<Record<string, boolean>>(
    {},
  );
  const [detailLoaded, setDetailLoaded] = useState<Set<string>>(
    () => new Set(),
  );
  const [qDraft, setQDraft] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [count, setCount] = useState(0);
  const excelRef = useRef<HTMLInputElement>(null);

  const [adjItem, setAdjItem] = useState("");
  const [adjBin, setAdjBin] = useState("");
  const [adjQtyAfter, setAdjQtyAfter] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const [mvItem, setMvItem] = useState("");
  const [mvFrom, setMvFrom] = useState("");
  const [mvTo, setMvTo] = useState("");
  const [mvQty, setMvQty] = useState("");

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
  }, [qApplied]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadItems();
      } catch (e) {
        if (!cancelled) {
          setMsg(
            e instanceof Error ? e.message : "讀取失敗（請確認 DB 是否已套用 schema）",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, loadItems]);

  const loadDetail = async (itemNo: string) => {
    setLoadingDetail((o) => ({ ...o, [itemNo]: true }));
    try {
      const [bRes, lRes] = await Promise.all([
        fetch(
          `/api/warehouse-ledger/bins?item_no=${encodeURIComponent(itemNo)}`,
        ),
        fetch(
          `/api/warehouse-ledger/lines?item_no=${encodeURIComponent(itemNo)}&limit=120`,
        ),
      ]);
      const bj = (await bRes.json()) as {
        bins?: BinRow[];
        bins_disabled?: boolean;
        error?: string;
      };
      const lj = (await lRes.json()) as { lines?: LedgerLine[]; error?: string };
      if (!bRes.ok) {
        setBinsByItem((o) => ({ ...o, [itemNo]: [] }));
        setBinsDisabled(true);
      } else {
        setBinsByItem((o) => ({ ...o, [itemNo]: bj.bins ?? [] }));
        setBinsDisabled(Boolean(bj.bins_disabled));
      }
      if (!lRes.ok) throw new Error(lj.error || "讀取異動失敗");
      setLinesByItem((o) => ({ ...o, [itemNo]: lj.lines ?? [] }));
      setDetailLoaded((prev) => new Set(prev).add(itemNo));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取明細失敗");
    } finally {
      setLoadingDetail((o) => ({ ...o, [itemNo]: false }));
    }
  };

  const toggleItem = async (itemNo: string) => {
    const willOpen = !expanded.has(itemNo);
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(itemNo)) n.delete(itemNo);
      else n.add(itemNo);
      return n;
    });
    if (willOpen && !detailLoaded.has(itemNo)) {
      await loadDetail(itemNo);
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
      const idxBin = guessColIdx(labs, IMPORT_HEADER_GROUPS.bin_code);

      if (idxItem < 0 || idxQty < 0) {
        throw new Error(
          "Excel 需可辨識「料號」與「現有總量／庫存」欄；含儲位時請加「儲位」欄。",
        );
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
        const row: Record<string, unknown> = {
          item_no,
          item_name,
          spec,
          on_hand: Math.floor(qty),
        };
        if (idxBin >= 0) {
          row.bin_code = String(r[idxBin] ?? "").trim();
        }
        rows.push(row);
      }

      if (!rows.length) throw new Error("無有效列可匯入");

      let total = 0;
      const CHUNK = 1200;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        const res = await fetch("/api/warehouse-ledger/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: part }),
        });
        const json = (await res.json()) as {
          error?: string;
          upserted?: number;
          mode?: string;
        };
        if (!res.ok) throw new Error(json.error || "上傳失敗");
        total += json.upserted ?? 0;
      }

      setMsg(
        `已匯入 ${total} 列（${idxBin >= 0 ? "含儲位明細" : "總量模式"}）`,
      );
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
    u.searchParams.set("scope", "lines");
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  const downloadStock = () => {
    const u = new URL("/api/warehouse-ledger/export", window.location.origin);
    u.searchParams.set("scope", "stock");
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  const downloadBins = () => {
    const u = new URL("/api/warehouse-ledger/export", window.location.origin);
    u.searchParams.set("scope", "bin_stock");
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  const submitStocktake = async () => {
    const op = session?.username?.trim() || "";
    if (!op) {
      setMsg("無法取得登入身分，請重新登入。");
      return;
    }
    if (!adjReason.trim()) {
      setMsg("盤點修正必須填寫原因");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouse-ledger/stocktake-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_no: normLedgerItemNo(adjItem),
          bin_code: adjBin.trim() || undefined,
          qty_after: Number(adjQtyAfter),
          reason: adjReason.trim(),
          operator_name: op,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "修正失敗");
      setMsg("盤點修正已入帳");
      setAdjReason("");
      await loadItems();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "修正失敗");
    } finally {
      setBusy(false);
    }
  };

  const submitTransfer = async () => {
    const op = session?.username?.trim() || "";
    if (!op) {
      setMsg("無法取得登入身分，請重新登入。");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouse-ledger/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_no: normLedgerItemNo(mvItem),
          from_bin: mvFrom.trim(),
          to_bin: mvTo.trim(),
          qty: Number(mvQty),
          operator_name: op,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "移庫失敗");
      setMsg("移庫完成");
      setMvQty("");
      await loadItems();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "移庫失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/80">
      <WarehouseSupervisorNav />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <AppBrandHeader section="倉儲總帳" align="left" />
            <p className={`mt-1 ${UI_LG} text-blue-800`}>
              版本：{APP_VERSION}
            </p>
          </div>
          <Link
            href={appHref("/admin")}
            className={`font-bold text-blue-800 underline ${UI_LG}`}
          >
            回派單控制台
          </Link>
        </header>

        {msg && (
          <div
            className={`rounded-xl p-4 ${UI_LG} text-white ${
              msg.includes("失敗") || msg.includes("僅") || msg.includes("無法")
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
              <h2 className={`${UI_LG} text-slate-900`}>管理員工具組</h2>
              <p className="mt-2 text-[1.1rem] font-semibold text-slate-600">
                Excel 需含：料號、品名、規格、庫存數量；批次初始化儲位時<strong>必加「儲位」欄</strong>
                （欄名支援：儲位、庫位、bin、location）。
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <label
                  className={`inline-flex cursor-pointer items-center rounded-xl bg-blue-800 px-4 py-2 text-white disabled:opacity-50 ${BTN_LG}`}
                >
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
                  {busy ? "上傳中…" : "Excel 上傳"}
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => downloadMoves()}
                  className={`rounded-xl border-2 border-slate-800 bg-white text-slate-900 disabled:opacity-50 ${BTN_LG}`}
                >
                  下載 · 異動軌跡
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => downloadStock()}
                  className={`rounded-xl border-2 border-slate-500 bg-slate-50 text-slate-800 disabled:opacity-50 ${BTN_LG}`}
                >
                  下載 · 主檔總量
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => downloadBins()}
                  className={`rounded-xl border-2 border-violet-600 bg-violet-50 text-violet-950 disabled:opacity-50 ${BTN_LG}`}
                >
                  下載 · 儲位明細
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void loadItems().catch((e) => setMsg(String(e)))}
                  className={`rounded-xl bg-slate-800 text-white disabled:opacity-50 ${BTN_LG}`}
                >
                  重新整理
                </button>
              </div>

              <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <h3 className={`${UI_LG} text-slate-900`}>盤點手動修正</h3>
                  <p className="mt-1 text-sm font-bold text-slate-600">
                    僅限盤點落差；必填修正原因。操作員：{session?.username ?? "—"}
                  </p>
                  <label className={`mt-3 block ${UI_LG} text-slate-800`}>
                    料號
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={adjItem}
                      onChange={(e) => setAdjItem(e.target.value)}
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    儲位
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={adjBin}
                      onChange={(e) => setAdjBin(e.target.value)}
                      placeholder="空白＝預設儲位"
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    修正後數量
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={adjQtyAfter}
                      onChange={(e) => setAdjQtyAfter(e.target.value)}
                      inputMode="numeric"
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    修正原因（必填）
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitStocktake()}
                    className={`mt-3 w-full rounded-xl bg-amber-700 text-white disabled:opacity-50 ${BTN_LG}`}
                  >
                    送出盤點修正
                  </button>
                </div>

                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                  <h3 className={`${UI_LG} text-slate-900`}>移庫</h3>
                  <p className="mt-1 text-sm font-bold text-slate-600">
                    操作員：{session?.username ?? "—"}
                  </p>
                  <label className={`mt-3 block ${UI_LG} text-slate-800`}>
                    料號
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={mvItem}
                      onChange={(e) => setMvItem(e.target.value)}
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    來源儲位
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={mvFrom}
                      onChange={(e) => setMvFrom(e.target.value)}
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    目的儲位
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={mvTo}
                      onChange={(e) => setMvTo(e.target.value)}
                    />
                  </label>
                  <label className={`mt-2 block ${UI_LG} text-slate-800`}>
                    數量
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold"
                      value={mvQty}
                      onChange={(e) => setMvQty(e.target.value)}
                      inputMode="numeric"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submitTransfer()}
                    className={`mt-3 w-full rounded-xl bg-indigo-700 text-white disabled:opacity-50 ${BTN_LG}`}
                  >
                    執行移庫
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200">
              <h2 className={`${UI_LG} text-slate-900`}>動態總帳清單</h2>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className={`grid gap-1 ${UI_LG} text-slate-800`}>
                  搜尋（料號／品名／儲位）
                  <input
                    className="min-h-[52px] w-72 max-w-full rounded-lg border border-slate-300 px-3 text-base font-bold"
                    value={qDraft}
                    onChange={(e) => setQDraft(e.target.value)}
                    placeholder="輸入關鍵字後套用"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setQApplied(qDraft.trim())}
                  className={`rounded-lg bg-slate-700 text-white disabled:opacity-50 ${BTN_LG}`}
                >
                  套用搜尋
                </button>
              </div>
              <p className="mt-2 text-[1.1rem] font-bold text-slate-500">
                本頁顯示 {items.length} 筆
                {count ? `（符合 ${count} 筆）` : ""}
              </p>

              <div className="mt-4 space-y-2">
                {items.map((it) => {
                  const open = expanded.has(it.item_no);
                  const bins = binsByItem[it.item_no] ?? [];
                  const lines = linesByItem[it.item_no] ?? [];
                  const loading = loadingDetail[it.item_no];
                  const qrVal = buildLedgerQrPayloadNoBin(
                    it.item_no,
                    it.item_name ?? "",
                    it.spec ?? "",
                  );
                  return (
                    <article
                      key={it.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/80"
                    >
                      <div className="flex flex-wrap items-stretch gap-2 px-2 py-2 sm:px-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleItem(it.item_no)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-white/80"
                        >
                          <ChevronDown
                            className={`h-6 w-6 shrink-0 text-slate-600 transition-transform ${
                              open ? "rotate-180" : ""
                            }`}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`font-mono ${UI_LG} text-slate-900`}>
                              {it.item_no}
                            </div>
                            <div className="text-[1.1rem] font-bold text-slate-600">
                              {it.item_name}
                              {it.spec ? ` · ${it.spec}` : ""}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-[1.15rem] font-black text-emerald-800">
                              <span>總庫存 {it.on_hand}</span>
                              {it.updated_at ? (
                                <span className="font-bold text-slate-500">
                                  更新 {fmtLineTs(it.updated_at)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                        <div className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-2 py-2">
                          <p className="text-[10px] font-black text-slate-500">
                            標籤 QR（無儲位）
                          </p>
                          {qrVal.trim() ? (
                            <QRCodeSVG value={qrVal} size={72} level="M" />
                          ) : null}
                        </div>
                      </div>

                      {open && (
                        <div className="border-t border-slate-200 bg-white px-3 py-3">
                          {loading ? (
                            <p className="py-4 text-center text-[1.1rem] font-bold text-slate-500">
                              載入儲位與異動…
                            </p>
                          ) : (
                            <>
                              <h4 className={`${UI_LG} text-slate-800`}>
                                儲位分布
                              </h4>
                              {binsDisabled ? (
                                <p className="mt-2 text-[1rem] font-bold text-amber-800">
                                  尚未建立儲位表：請執行 patch_warehouse_ledger_multi_bin.sql
                                </p>
                              ) : bins.length === 0 ? (
                                <p className="mt-2 text-[1rem] font-bold text-slate-500">
                                  無儲位明細（匯入 Excel 時加入儲位欄，或先由入出庫累積）
                                </p>
                              ) : (
                                <ul className="mt-2 space-y-1">
                                  {bins.map((b) => (
                                    <li
                                      key={`${it.item_no}-${b.bin_code}`}
                                      className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-[1.1rem] font-bold text-slate-800"
                                    >
                                      <span className="font-mono">{b.bin_code}</span>
                                      <span>{b.qty} 件</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <h4 className={`mt-4 ${UI_LG} text-slate-800`}>
                                生命軌跡（異動）
                              </h4>
                              {lines.length === 0 ? (
                                <p className="mt-2 text-[1rem] font-bold text-slate-500">
                                  尚無紀錄
                                </p>
                              ) : (
                                <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                                  {lines.map((ln) => {
                                    const refObj =
                                      ln.ref &&
                                      typeof ln.ref === "object" &&
                                      !Array.isArray(ln.ref)
                                        ? (ln.ref as Record<string, unknown>)
                                        : {};
                                    const op =
                                      (ln.operator_name &&
                                        String(ln.operator_name).trim()) ||
                                      (refObj.operator_name != null
                                        ? String(refObj.operator_name)
                                        : "—");
                                    const from =
                                      ln.from_bin != null
                                        ? String(ln.from_bin)
                                        : "—";
                                    const to =
                                      ln.to_bin != null
                                        ? String(ln.to_bin)
                                        : "—";
                                    const displayDelta =
                                      ln.direction === "outbound"
                                        ? -Math.abs(ln.qty_delta)
                                        : ln.qty_delta;
                                    return (
                                      <li
                                        key={ln.id}
                                        className="rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2 text-[1.05rem] font-semibold leading-snug text-slate-900"
                                      >
                                        <div className="font-mono text-slate-600">
                                          {fmtLineTs(ln.created_at)}
                                        </div>
                                        <div className="mt-1 font-black">
                                          {txLabel(ln.tx_type, ln.direction)} ·
                                          操作員 {op}
                                        </div>
                                        <div className="mt-1">
                                          儲位：{from} → {to}
                                        </div>
                                        <div className="mt-1">
                                          數量 {displayDelta > 0 ? "+" : ""}
                                          {displayDelta} · 總帳結餘{" "}
                                          {ln.balance_after}
                                          {ln.bin_balance_after != null &&
                                          ln.bin_balance_after !== undefined
                                            ? ` · 儲位結餘 ${ln.bin_balance_after}`
                                            : ""}
                                        </div>
                                        {refObj.correction_reason ? (
                                          <div className="mt-1 text-amber-900">
                                            原因：{String(refObj.correction_reason)}
                                          </div>
                                        ) : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!items.length && (
                  <p className="py-10 text-center text-[1.2rem] font-bold text-slate-500">
                    尚無總帳資料 · 請先以 Excel 初始化
                  </p>
                )}
              </div>
            </section>

            <p className="text-center text-[1rem] font-semibold text-slate-500">
              多儲位請執行：supabase/patch_warehouse_ledger_multi_bin.sql
            </p>
          </>
        )}
      </main>
    </div>
  );
}
