"use client";

import { Camera, MapPin, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appHref } from "@/lib/appHref";

export type FlowRow = {
  id: string;
  item_no: string;
  po_no: string;
  item_name: string;
  current_stage: string;
  location_label: string;
  entered_at: string;
  dwell_hours: number;
};

type BinRow = { bin_code: string; qty: number };

function stageBadge(stage: string): { cls: string; label: string } {
  if (stage === "pending_inspect") {
    return { cls: "bg-amber-50 text-amber-700", label: "待驗" };
  }
  if (stage === "pending_putaway") {
    return { cls: "bg-blue-50 text-blue-600", label: "倉庫-待上架" };
  }
  if (stage === "stocked") {
    return { cls: "bg-slate-100 text-slate-600", label: "已入庫" };
  }
  if (stage === "pending_ship") {
    return { cls: "bg-yellow-50 text-yellow-700", label: "待出貨" };
  }
  return { cls: "bg-slate-100 text-slate-700", label: String(stage) };
}

function formatDwell(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "—";
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const m = Math.round(hours * 60);
  return `${m} min`;
}

function formatDwellForRow(hours: number, stage: string): string {
  if (stage === "stocked") return "—";
  return formatDwell(hours);
}

function alertTag(stage: string): string {
  if (stage === "pending_inspect") return "待驗逾時";
  if (stage === "pending_putaway") return "上架逾時";
  if (stage === "pending_ship") return "出貨逾時";
  return "流程逾時";
}

function rowMatchesQuery(
  f: FlowRow,
  qLower: string,
  tokens: string[],
  binMatchedItemNos: Set<string>,
): boolean {
  if (!qLower) return true;
  if (binMatchedItemNos.has(f.item_no.trim())) return true;
  const pool = [f.item_no, f.po_no, f.item_name, f.location_label]
    .join(" ")
    .toLowerCase();
  if (tokens.length <= 1) return pool.includes(qLower);
  return tokens.every((t) => t && pool.includes(t));
}

export function MonitorDashboard() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [alerts, setAlerts] = useState<FlowRow[]>([]);
  const [stats, setStats] = useState({
    pending_inspect: 0,
    pending_putaway: 0,
    stocked: 0,
    pending_ship: 0,
  });
  const [thresholdHours, setThresholdHours] = useState(4);
  const [bins, setBins] = useState<BinRow[]>([]);
  const [binItemHits, setBinItemHits] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);

  const loadMonitor = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory-flow/monitor");
      const j = (await res.json()) as {
        flows?: FlowRow[];
        alerts?: FlowRow[];
        stats?: typeof stats;
        threshold_hours?: number;
      };
      setFlows(j.flows ?? []);
      setAlerts(j.alerts ?? []);
      if (j.stats) setStats(j.stats);
      if (typeof j.threshold_hours === "number") {
        setThresholdHours(j.threshold_hours);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonitor();
    const t = window.setInterval(() => void loadMonitor(), 60_000);
    return () => window.clearInterval(t);
  }, [loadMonitor]);

  const qTrim = q.trim();
  const qLower = qTrim.toLowerCase();
  const tokens = useMemo(
    () =>
      qLower
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean),
    [qLower],
  );

  useEffect(() => {
    if (!qTrim) {
      setBinItemHits(new Set());
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      void (async () => {
        const res = await fetch(
          `/api/warehouse-ledger/match-bins?q=${encodeURIComponent(qTrim)}`,
        );
        const j = (await res.json()) as { item_nos?: string[] };
        if (cancelled) return;
        setBinItemHits(new Set(j.item_nos ?? []));
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [qTrim]);

  const filtered = useMemo(() => {
    return flows.filter((f) =>
      rowMatchesQuery(f, qLower, tokens, binItemHits),
    );
  }, [flows, qLower, tokens, binItemHits]);

  useEffect(() => {
    const term = qTrim;
    if (term.length < 2) {
      setBins([]);
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      void (async () => {
        const res = await fetch(
          `/api/warehouse-ledger/bins?item_no=${encodeURIComponent(term)}`,
        );
        const j = (await res.json()) as {
          bins?: BinRow[];
          bins_disabled?: boolean;
        };
        if (cancelled) return;
        if (j.bins_disabled || !res.ok) {
          setBins([]);
          return;
        }
        setBins(j.bins ?? []);
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [qTrim]);

  const showBinPanel = qTrim.length >= 2 && bins.length > 0;

  const startScan = () => {
    router.push(appHref("/qr-center/scan"));
  };

  return (
    <div className="monitor-dashboard min-h-screen bg-[#f8fafc] p-8 font-sans text-slate-800">
      <div className="mx-auto mb-10 max-w-6xl">
        <div className="flex min-h-[4.25rem] items-center rounded-full border border-slate-100 bg-white p-3 pl-5 shadow-lg">
          <div className="flex min-h-[3.5rem] flex-grow items-center px-4 sm:px-6">
            <Search
              className="mr-3 h-9 w-9 shrink-0 text-[#3b82f6] sm:mr-4 sm:h-10 sm:w-10"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="text"
              id="global-search-input"
              placeholder="搜尋料號…"
              className="w-full min-h-[1.25rem] bg-transparent text-[1.25rem] leading-normal outline-none sm:text-2xl"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={startScan}
            className="flex shrink-0 items-center rounded-full bg-[#3b82f6] px-8 py-4 text-[1.25rem] font-bold text-white shadow-md transition hover:bg-blue-700 sm:px-10 sm:text-xl"
          >
            <Camera className="mr-3 h-6 w-6" strokeWidth={2.5} aria-hidden />
            掃描標籤
          </button>
        </div>
      </div>

      {showBinPanel ? (
        <div className="mx-auto mb-8 max-w-7xl rounded-[2rem] border border-blue-100 bg-white p-8 shadow-sm">
          <h3 className="mb-4 min-h-[1.25rem] text-3xl font-bold text-blue-900">
            料號「{qTrim}」儲位分布
          </h3>
          <p className="mb-4 text-xl text-slate-600">
            QR 標籤僅含料號／品項資訊，不含儲位代碼。
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bins.map((b) => (
              <div
                key={b.bin_code}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-5 py-4"
              >
                <span className="min-h-[1.25rem] font-mono text-xl font-bold text-slate-800">
                  {b.bin_code}
                </span>
                <span className="text-5xl font-black leading-none text-[#3b82f6] sm:text-6xl">
                  {b.qty}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-4">
          <div className="mb-6 flex items-center">
            <div className="mr-3 h-8 w-1.5 bg-red-500" />
            <h2 className="min-h-[1.25rem] text-3xl font-bold">異常滯留警報</h2>
          </div>

          {loading ? (
            <p className="text-xl font-bold text-slate-500">載入…</p>
          ) : alerts.length === 0 ? (
            <div className="relative overflow-hidden rounded-[2rem] border border-slate-100 bg-white p-8 shadow-sm">
              <div className="absolute bottom-0 left-0 top-0 w-3 bg-emerald-500" />
              <p className="pl-4 text-xl font-bold text-slate-600">
                目前無逾時案件（閾值 {thresholdHours} 小時）
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {alerts.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="relative overflow-hidden rounded-[2rem] border border-slate-100 bg-white p-8 shadow-sm"
                >
                  <div className="absolute bottom-0 left-0 top-0 w-3 bg-red-500" />
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <span className="rounded-md bg-red-100 px-4 py-1 text-center text-xl font-bold text-red-600">
                      {alertTag(a.current_stage)}
                    </span>
                    <span className="text-5xl font-black leading-none text-red-600 sm:text-6xl">
                      {formatDwell(a.dwell_hours)}
                    </span>
                  </div>
                  <h3 className="mb-2 text-3xl font-bold">{a.po_no || "—"}</h3>
                  <p className="mb-6 text-2xl text-slate-600">
                    {a.item_name || a.item_no || "—"}
                  </p>
                  <div className="flex items-center text-xl font-medium text-red-500">
                    <MapPin className="mr-2 h-6 w-6 shrink-0" aria-hidden />
                    {a.location_label || "—"}
                  </div>
                  <Link
                    href={appHref(
                      `/dashboard/flow/${encodeURIComponent(a.id)}`,
                    )}
                    className="mt-6 inline-block text-xl font-bold text-[#3b82f6] underline"
                  >
                    查看異動軌跡
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-12 text-center lg:col-span-8 lg:text-left">
          <div className="mb-6 flex items-center justify-center lg:justify-start">
            <div className="mr-3 h-8 w-1.5 bg-blue-600" />
            <h2 className="min-h-[1.25rem] text-3xl font-bold">
              即時流動狀態
            </h2>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-slate-100 bg-white text-left shadow-sm ring-1 ring-slate-100/80">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xl text-slate-400">
                  <th className="p-8 text-left font-medium">物料資訊</th>
                  <th className="p-8 text-center font-medium">當前環節</th>
                  <th className="p-8 text-center font-medium">停留時間</th>
                  <th className="p-8 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="text-xl">
                {filtered.map((row) => {
                  const bg = stageBadge(row.current_stage);
                  const isStocked = row.current_stage === "stocked";
                  const loc = (row.location_label || "").trim();
                  const stageDisplay = isStocked
                    ? loc
                      ? `已入庫（${loc}）`
                      : "已入庫"
                    : bg.label;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-50 transition hover:bg-slate-50"
                    >
                      <td className="p-8 text-left">
                        <div className="text-2xl font-bold text-slate-800">
                          {row.item_name || row.item_no || "—"}
                        </div>
                        <div className="mt-1 text-xl text-slate-400">
                          {row.po_no || row.item_no || "—"}
                        </div>
                      </td>
                      <td className="p-8 text-center">
                        {isStocked ? (
                          <span className="font-medium text-slate-600">
                            {stageDisplay}
                          </span>
                        ) : (
                          <span
                            className={`inline-block rounded-md px-4 py-2 font-medium ${bg.cls}`}
                          >
                            {bg.label}
                          </span>
                        )}
                      </td>
                      <td className="p-8 text-center text-[1.25rem] font-bold tabular-nums tracking-tight">
                        {formatDwellForRow(row.dwell_hours, row.current_stage)}
                      </td>
                      <td className="p-8 text-right">
                        <Link
                          href={appHref(
                            `/dashboard/flow/${encodeURIComponent(row.id)}`,
                          )}
                          className="text-xl font-bold text-[#3b82f6] hover:underline"
                        >
                          {isStocked ? "履歷" : "追蹤"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length === 0 && !loading ? (
              <p className="p-8 text-center text-xl font-bold text-slate-500">
                無符合資料
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-around gap-y-6 rounded-b-[2rem] bg-[#1e293b] px-4 py-10 sm:px-8">
              <div className="text-center">
                <p className="mb-2 text-[1.25rem] text-slate-400">待驗中</p>
                <p className="text-5xl font-black leading-none text-white sm:text-6xl">
                  {String(stats.pending_inspect).padStart(2, "0")}
                </p>
              </div>
              <div className="hidden h-12 w-px bg-slate-700 sm:block" />
              <div className="text-center">
                <p className="mb-2 text-[1.25rem] text-slate-400">待入庫</p>
                <p className="text-5xl font-black leading-none text-white sm:text-6xl">
                  {String(stats.pending_putaway).padStart(2, "0")}
                </p>
              </div>
              <div className="hidden h-12 w-px bg-slate-700 sm:block" />
              <div className="text-center">
                <p className="mb-2 text-[1.25rem] text-yellow-500">待出貨</p>
                <p className="text-5xl font-black leading-none text-yellow-500 sm:text-6xl">
                  {String(stats.pending_ship).padStart(2, "0")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
