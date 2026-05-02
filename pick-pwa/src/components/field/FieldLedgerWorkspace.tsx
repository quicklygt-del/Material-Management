"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bluetoothSendText,
  formatLabelPrintLines,
  isWebBluetoothAvailable,
} from "@/lib/bluetoothPrint";
import {
  buildLabelQrPayload,
  getDefaultLabelPrefix,
  parseLabelQrPayload,
  resolveSerialSource,
} from "@/lib/labelEncoding";
import { useQrCenterTenant } from "@/lib/qrCenterTenant";

const TAB_KEY = "wms-warehouse-tab-v1";

type Zone = { id: string; name: string };

type LookupRecord = {
  id?: string;
  label_type: string;
  item_no: string;
  qr_payload: string;
  meta: Record<string, unknown> | null;
  created_at?: string;
  manageable_asset?: boolean | null;
};

function isManageable(record: LookupRecord): boolean {
  if (record.manageable_asset === false) return false;
  const m = record.meta;
  if (m && m.manageable_asset === false) return false;
  return record.label_type !== "Q";
}

function subtitleForLedger(record: LookupRecord): string {
  const m = record.meta ?? {};
  const item = String(record.item_no ?? "").trim();
  if (record.label_type === "D") {
    const desc = String(m.description ?? "").trim();
    const name = String(m.project_name ?? "").trim();
    if (desc && name) return `${name}\n${desc}`;
    return desc || name || item || "—";
  }
  if (record.label_type === "B") {
    const note = String(
      (m as { bundle_note?: unknown }).bundle_note ?? m.description ?? "",
    ).trim();
    if (note && item && item !== "-") return `${item}\n${note}`;
    return item && item !== "-" ? item : note || "—";
  }
  return item && item !== "-" ? item : "—";
}

function materialSummary(record: LookupRecord): string {
  const wf = record.meta?.workflow_mode;
  const t = record.label_type;
  if (t === "S") return "一般物料";
  if (t === "R") return wf === "surplus_rq" ? "餘料" : "餘料／退料";
  if (t === "B") return "裝箱";
  if (t === "Q") return "不良品";
  if (t === "D") return "非物料類";
  return "標籤";
}

/** 物料類：標準標籤可解析料號等；其他為非物料 */
function isMaterialType(record: LookupRecord): boolean {
  return record.label_type !== "D";
}

export function FieldLedgerWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantId } = useQrCenterTenant();
  const companyId = useMemo(
    () => tenantId || getDefaultLabelPrefix(),
    [tenantId],
  );

  const [zones, setZones] = useState<Zone[]>([]);
  const [zBusy, setZBusy] = useState(false);
  const [tabId, setTabId] = useState("");
  const tabInitDone = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newZ, setNewZ] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrRaw, setQrRaw] = useState("");
  const [busyLook, setBusyLook] = useState(false);
  const [record, setRecord] = useState<LookupRecord | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const [errLook, setErrLook] = useState<string | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [balBusy, setBalBusy] = useState(false);

  const [qty, setQty] = useState(1);
  const [invBusy, setInvBusy] = useState(false);
  const [invEcho, setInvEcho] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [memo, setMemo] = useState("");
  const [printBusy, setPrintBusy] = useState(false);
  const [canScan, setCanScan] = useState(false);

  useEffect(() => {
    setCanScan(
      typeof window !== "undefined" && "BarcodeDetector" in window,
    );
  }, []);

  const loadZones = useCallback(async () => {
    setZBusy(true);
    try {
      const u = new URL("/api/warehouses", window.location.origin);
      if (companyId) u.searchParams.set("tenant", companyId);
      const res = await fetch(u.toString());
      const json = (await res.json()) as {
        storage_zones?: Zone[];
        warehouses?: Zone[];
      };
      if (!res.ok) return;
      const raw = json.storage_zones ?? json.warehouses ?? [];
      setZones(raw.map((r) => ({ id: r.id, name: r.name })));
    } finally {
      setZBusy(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (searchParams.get("camera") !== "1") return;
    setScanOpen(true);
    router.replace("/field", { scroll: false });
  }, [router, searchParams]);

  /** 初始化分頁（僅初次） */
  useEffect(() => {
    if (zones.length === 0 || tabInitDone.current) return;
    tabInitDone.current = true;
    try {
      const s =
        typeof window !== "undefined"
          ? sessionStorage.getItem(TAB_KEY)?.trim()
          : "";
      const pick = s && zones.some((z) => z.id === s) ? s : zones[0]?.id ?? "";
      setTabId(pick);
      if (pick) sessionStorage.setItem(TAB_KEY, pick);
    } catch {
      setTabId(zones[0]?.id ?? "");
    }
  }, [zones]);

  const pickTab = useCallback((id: string) => {
    setTabId(id);
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      void 0;
    }
    setFound(null);
    setRecord(null);
    setQrRaw("");
    setErrLook(null);
    setInvEcho(null);
    setToast(null);
  }, []);

  const addZone = useCallback(async () => {
    const n = newZ.trim();
    if (!n || !companyId || addBusy || zones.length >= 5) return;
    setAddBusy(true);
    try {
      const res = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, tenant_id: companyId }),
      });
      const json = (await res.json()) as { warehouse?: { id: string } };
      if (!res.ok) return;
      setNewZ("");
      setAddOpen(false);
      await loadZones();
      if (json.warehouse?.id) pickTab(json.warehouse.id);
    } finally {
      setAddBusy(false);
    }
  }, [
    addBusy,
    companyId,
    loadZones,
    newZ,
    pickTab,
    zones.length,
  ]);

  const fetchBalance = useCallback(
    async (labelRecordId: string, warehouseId: string) => {
      if (!labelRecordId || !warehouseId) {
        setBalance(null);
        return;
      }
      setBalBusy(true);
      try {
        const u = new URL("/api/inventory/balance", window.location.origin);
        u.searchParams.set("label_record_id", labelRecordId);
        u.searchParams.set("warehouse_id", warehouseId);
        const res = await fetch(u.toString());
        const json = (await res.json()) as { on_hand?: number };
        if (!res.ok) throw new Error("x");
        setBalance(Number(json.on_hand ?? 0));
      } catch {
        setBalance(null);
      } finally {
        setBalBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!record?.id || !tabId) {
      setBalance(null);
      return;
    }
    void fetchBalance(record.id, tabId);
  }, [fetchBalance, record?.id, tabId]);

  const fetchRecord = useCallback(
    async (rawIn: string) => {
      const raw = rawIn.replace(/\uFEFF/g, "").trim();
      setErrLook(null);
      setInvEcho(null);
      setToast(null);
      setRecord(null);
      setFound(null);
      setBalance(null);
      if (!raw) return;
      setBusyLook(true);
      try {
        const u = new URL("/api/label-records/lookup", window.location.origin);
        u.searchParams.set("tenant", companyId);
        u.searchParams.set("qr", raw);
        const res = await fetch(u.toString());
        const json = (await res.json()) as {
          found?: boolean;
          record?: LookupRecord;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "錯誤");
        setFound(Boolean(json.found));
        setRecord(json.record ?? null);
        setQrRaw(raw);
      } catch (e) {
        setErrLook(e instanceof Error ? e.message : "錯誤");
      } finally {
        setBusyLook(false);
      }
    },
    [companyId],
  );

  useEffect(() => {
    if (!scanOpen || !canScan || typeof window === "undefined") {
      return;
    }

    const Detector = window.BarcodeDetector;
    if (!Detector) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    const tick = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const v = codes[0]?.rawValue?.trim();
        if (v) {
          stopped = true;
          stream?.getTracks().forEach((t) => t.stop());
          void fetchRecord(v);
          return;
        }
      } catch {
        void 0;
      }
      raf = requestAnimationFrame(() => void tick());
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        return;
      }
      const v = videoRef.current;
      if (!v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      raf = requestAnimationFrame(() => void tick());
    };

    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [canScan, scanOpen, fetchRecord]);

  const serialLine = useMemo(() => {
    if (!qrRaw) return "—";
    const p = parseLabelQrPayload(qrRaw);
    const s = p?.serial ?? "";
    return s || qrRaw;
  }, [qrRaw]);

  const submitInventory = useCallback(
    async (kind: "inbound" | "pick" | "stocktake") => {
      setInvEcho(null);
      if (!companyId || !record || !tabId) return;
      if (kind !== "stocktake") {
        if (!Number.isFinite(qty) || qty <= 0) {
          setInvEcho("數量無效");
          return;
        }
      } else if (!Number.isFinite(qty) || qty === 0) {
        setInvEcho("數量無效");
        return;
      }
      const qv =
        kind === "stocktake" ? Math.trunc(qty) : Math.abs(Math.trunc(qty));
      setInvBusy(true);
      try {
        const res = await fetch("/api/inventory/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: companyId,
            label_record_id: record.id ?? "",
            qr_payload: record.qr_payload,
            warehouse_id: tabId,
            operator_name: "現場",
            action_type: kind,
            quantity: qv,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "失敗");
        setInvEcho("OK");
        if (record.id) void fetchBalance(record.id, tabId);
      } catch (e) {
        setInvEcho(e instanceof Error ? e.message : "失敗");
      } finally {
        setInvBusy(false);
      }
    },
    [companyId, fetchBalance, qty, record, tabId],
  );

  const printLedgerLabel = useCallback(async () => {
    const note = memo.trim();
    if (!companyId || !note || printBusy) return;
    const src = resolveSerialSource("D", {
      itemNo: "",
      bundleNo: "",
      contentNote: note,
      rndProject: note.slice(0, 72),
      rndOwner: "",
    });
    let payload: string;
    try {
      payload = buildLabelQrPayload({
        typeCode: "D",
        serialSource: src,
      });
    } catch {
      setToast("產製失敗");
      return;
    }
    const at = new Date();
    const foot = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const itemLine = note.length > 80 ? `${note.slice(0, 80)}…` : note;
    setPrintBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/label-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: companyId,
          label_type: "D",
          qr_payload: payload,
          item_no: "-",
          color_code: null,
          operator_id: "ledger",
          meta: {
            workflow_mode: "ledger_minimal",
            project_name: note.slice(0, 200),
            description: note,
            operation_unit: "現場",
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "存檔失敗");
      if (!isWebBluetoothAvailable()) throw new Error("x");
      const lines = formatLabelPrintLines({
        qrPayload: payload,
        itemLine,
        footerLine: foot,
        title: "萬用帳本標籤",
        operationUnit: "現場",
      });
      await bluetoothSendText(lines);
      setToast("OK");
      setMemo("");
    } catch {
      setToast("列印失敗");
    } finally {
      setPrintBusy(false);
    }
  }, [companyId, memo, printBusy]);

  const zoneName =
    zones.find((z) => z.id === tabId)?.name ?? "";

  return (
    <div className="pb-[calc(11rem+env(safe-area-inset-bottom))] pt-2 text-zinc-900">
      <div className="mx-auto flex max-w-lg gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {zBusy ? (
          <span className="shrink-0 py-3 text-xs font-bold text-slate-500">…</span>
        ) : (
          zones.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => pickTab(z.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-black shadow-sm transition-colors sm:py-2.5 ${
                tabId === z.id
                  ? "bg-emerald-700 text-white"
                  : "border border-zinc-300 bg-white active:bg-zinc-50"
              }`}
            >
              {z.name}
            </button>
          ))
        )}
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="flex h-[2.625rem] w-[2.625rem] shrink-0 items-center justify-center rounded-full border-2 border-dashed border-emerald-600 text-lg font-black text-emerald-700 shadow-sm disabled:opacity-40"
          disabled={zones.length >= 5}
          aria-label="新增分頁"
        >
          ＋
        </button>
      </div>

      {addOpen && (
        <div className="mx-auto mb-2 flex max-w-lg gap-2 px-3">
          <input
            className="min-h-10 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-bold"
            value={newZ}
            onChange={(e) => setNewZ(e.target.value)}
            disabled={zones.length >= 5 || addBusy}
            aria-label="分頁名稱"
          />
          <button
            type="button"
            disabled={!newZ.trim() || addBusy || zones.length >= 5}
            onClick={() => void addZone()}
            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            新增
          </button>
        </div>
      )}

      <div className="mx-auto max-w-lg px-3">
        <div className="mb-2 rounded-xl border border-emerald-200/70 bg-emerald-50/50 px-3 py-1.5 text-center text-xs font-black text-emerald-900">
          <span>{zoneName || "—"}</span>
          {record?.id && tabId ? (
            <>
              {" · "}
              <span>結存 {balBusy ? "…" : balance ?? "—"}</span>
            </>
          ) : null}
        </div>

        <label className="mb-2 grid gap-1">
          <span className="text-xs font-black text-zinc-600">內容說明</span>
          <div className="flex gap-2">
            <input
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-bold"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={printBusy}
            />
            <button
              type="button"
              disabled={!memo.trim() || printBusy}
              onClick={() => void printLedgerLabel()}
              className="shrink-0 rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
            >
              產製標籤
            </button>
          </div>
        </label>

        <div className="mb-2 grid gap-1">
          <button
            type="button"
            onClick={() => setScanOpen((s) => !s)}
            className="rounded-xl border-2 border-zinc-900 bg-zinc-900 py-3 text-base font-black text-white"
          >
            掃描
          </button>
          {scanOpen && (
            <>
              {canScan ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-zinc-300 bg-black">
                  <video
                    ref={videoRef}
                    className="max-h-[9rem] w-full object-cover"
                    playsInline
                    muted
                    aria-hidden
                  />
                </div>
              ) : null}
              <textarea
                className="mt-2 min-h-[3.75rem] max-h-[5rem] w-full resize-none rounded-xl border border-zinc-400 bg-white px-3 py-2 font-mono text-xs font-bold"
                placeholder=""
                value={qrRaw}
                onChange={(e) => setQrRaw(e.target.value)}
              />
              <button
                type="button"
                disabled={busyLook || !qrRaw.trim()}
                onClick={() => void fetchRecord(qrRaw)}
                className="mt-2 w-full rounded-xl border border-zinc-600 bg-white py-2.5 text-sm font-black disabled:opacity-40"
              >
                {busyLook ? "…" : "辨識"}
              </button>
            </>
          )}
        </div>

        {errLook && (
          <p className="mb-2 text-center text-xs font-black text-red-700">
            {errLook}
          </p>
        )}

        {found === false && !errLook && (
          <p className="mb-2 text-center text-sm font-black">查無紀錄</p>
        )}

        {record ? (
          <section className="mb-36 rounded-xl border border-zinc-300 bg-white p-4 shadow-md">
            <p className="text-center font-mono text-[11px] font-bold text-zinc-500">
              編號 {serialLine.slice(0, 28)}
              {serialLine.length > 28 ? "…" : ""}
            </p>
            <p className="mt-1 text-center text-xs font-black text-zinc-500">
              {isMaterialType(record)
                ? "品名／料號 · " + materialSummary(record)
                : "內容說明 · " + materialSummary(record)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-center text-lg font-black leading-snug text-zinc-900">
              {subtitleForLedger(record)}
            </p>
          </section>
        ) : null}
      </div>

      {record && isManageable(record) && tabId ? (
        <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-[#FAFDFC] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_14px_rgba(0,0,0,.06)]">
          <input
            type="number"
            className="mb-3 h-11 w-full rounded-xl border-2 border-zinc-400 bg-white px-3 text-center text-lg font-black"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            disabled={invBusy}
          />
          <div className="mx-auto grid max-w-lg grid-cols-3 gap-2">
            <button
              type="button"
              disabled={invBusy}
              onClick={() => void submitInventory("inbound")}
              className="rounded-xl bg-emerald-700 py-3 text-sm font-black leading-tight text-white disabled:opacity-45"
            >
              ＋入庫
            </button>
            <button
              type="button"
              disabled={invBusy}
              onClick={() => void submitInventory("pick")}
              className="rounded-xl border-2 border-amber-600 bg-white py-3 text-sm font-black leading-tight text-amber-900 disabled:opacity-45"
            >
              －領用
            </button>
            <button
              type="button"
              disabled={invBusy}
              onClick={() => void submitInventory("stocktake")}
              className="rounded-xl bg-slate-100 py-3 text-sm font-black leading-tight text-slate-900 disabled:opacity-45"
            >
              ＝盤點
            </button>
          </div>
          {invEcho ? (
            <p
              className={`mt-2 text-center text-xs font-black ${
                invEcho === "OK" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {invEcho}
            </p>
          ) : null}
        </footer>
        ) : null}

      {toast && !(record && isManageable(record) && tabId) ? (
        <p
          className={`fixed bottom-24 left-1/2 z-[19] w-[min(100%,26rem)] -translate-x-1/2 px-4 pb-[env(safe-area-inset-bottom)] text-center text-xs font-black ${
            toast === "OK" ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {toast === "OK" ? "OK" : toast}
        </p>
      ) : null}
    </div>
  );
}
