"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const TAB_STORAGE_KEY = "wms-warehouse-tab-v1";

type LookupRecord = {
  id?: string;
  label_type: string;
  item_no: string;
  qr_payload: string;
  meta: Record<string, unknown> | null;
  created_at?: string;
  warehouse_id?: string | null;
  manageable_asset?: boolean | null;
};

type WarehouseOpt = { id: string; name: string };

function isManageableAsset(record: LookupRecord): boolean {
  if (record.manageable_asset === false) return false;
  const m = record.meta;
  if (m && m.manageable_asset === false) return false;
  if (record.label_type === "Q") return false;
  return true;
}

function categoryHeadline(record: LookupRecord): string {
  const wf = record.meta?.workflow_mode;
  const t = record.label_type;
  if (t === "S") return "一般物料";
  if (t === "R") return wf === "surplus_rq" ? "餘料（RQ）" : "餘料／退料";
  if (t === "B") return "裝箱集合";
  if (t === "Q") return "不良品";
  if (t === "D") return "資產";
  return "標籤紀錄";
}

function primarySubtitle(record: LookupRecord): string {
  const m = record.meta ?? {};
  const item = String(record.item_no ?? "").trim();
  if (record.label_type === "D") {
    const desc = String(m.description ?? "").trim();
    const project = String(m.project_name ?? "").trim();
    if (desc && project) return `${project}\n${desc}`;
    if (desc) return desc;
    if (project && item && item !== "-" && item !== project) {
      return `${project}\n${item}`;
    }
    return project || item || "—";
  }
  if (record.label_type === "B") {
    const note = String(
      (m as { bundle_note?: unknown }).bundle_note ?? m.description ?? "",
    ).trim();
    if (note && item && item !== "-") return `${item}\n${note}`;
    return item && item !== "-" ? item : note || "裝箱標籤";
  }
  return item && item !== "-" ? item : "—";
}

function formatCreatedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type Props = {
  cameraMode: boolean;
  /** standalone：QR 標籤中心旁的掃描頁；assetHub：門戶行動資產區（極簡、無深色） */
  variant?: "standalone" | "assetHub" | "assetHubCamera";
};

/** 與 /operator 相同：全螢幕黑底＋綠角框＋底部手動輸入。 */
export function WarehouseTabScanWorkspace({
  cameraMode,
  variant = "standalone",
}: Props) {
  const isAssetHub =
    variant === "assetHub" || variant === "assetHubCamera";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningActiveRef = useRef(false);
  const decodeRafRef = useRef<number | null>(null);
  const busyMirrorRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({
    code: "",
    at: 0,
  });
  const lastDetectAtRef = useRef(0);

  const [scanOpen, setScanOpen] = useState(false);
  const [scanManualInput, setScanManualInput] = useState("");

  const [qrInput, setQrInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [record, setRecord] = useState<LookupRecord | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const autoFetchedKey = useRef<string | null>(null);

  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([]);
  const [whListBusy, setWhListBusy] = useState(false);
  const [tabWarehouseId, setTabWarehouseId] = useState("");
  const tabInitDone = useRef(false);

  const [onHand, setOnHand] = useState<number | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);

  const [invQty, setInvQty] = useState(1);
  const [operatorName, setOperatorName] = useState("現場");
  const [invBusy, setInvBusy] = useState(false);
  const [invMsg, setInvMsg] = useState<string | null>(null);

  const [newZoneName, setNewZoneName] = useState("");
  const [addZoneBusy, setAddZoneBusy] = useState(false);

  useEffect(() => {
    busyMirrorRef.current = busy;
  }, [busy]);

  const stopScanHardware = useCallback(() => {
    scanningActiveRef.current = false;
    if (decodeRafRef.current != null) {
      cancelAnimationFrame(decodeRafRef.current);
      decodeRafRef.current = null;
    }
    if (streamRef.current) {
      for (const tr of streamRef.current.getTracks()) tr.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const currentSiteName = useMemo(() => {
    const w = warehouses.find((x) => x.id === tabWarehouseId);
    return w?.name ?? "";
  }, [warehouses, tabWarehouseId]);

  const loadZones = useCallback(async () => {
    setWhListBusy(true);
    try {
      const u = new URL("/api/warehouses", window.location.origin);
      const res = await fetch(u.toString());
      const json = (await res.json()) as {
        storage_zones?: { id: string; name: string }[];
        warehouses?: { id: string; name: string }[];
        error?: string;
      };
      if (!res.ok) return;
      const raw = json.storage_zones ?? json.warehouses ?? [];
      const list = raw.map((w) => ({
        id: w.id,
        name: w.name,
      }));
      setWarehouses(list);
    } finally {
      setWhListBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  /** 預選分頁：URL ?w= > sessionStorage > 第一個倉 */
  useEffect(() => {
    if (warehouses.length === 0 || tabInitDone.current) return;
    tabInitDone.current = true;
    const fromUrl = searchParams.get("w")?.trim();
    let pick =
      fromUrl && warehouses.some((w) => w.id === fromUrl) ? fromUrl : "";
    if (!pick) {
      try {
        const s = sessionStorage.getItem(TAB_STORAGE_KEY)?.trim();
        if (s && warehouses.some((w) => w.id === s)) pick = s;
      } catch {
        void 0;
      }
    }
    if (!pick) pick = warehouses[0]?.id ?? "";
    setTabWarehouseId(pick);
    try {
      if (pick) sessionStorage.setItem(TAB_STORAGE_KEY, pick);
    } catch {
      void 0;
    }
    const cur = searchParams.get("w");
    if (pick && cur !== pick) {
      const p = new URLSearchParams(searchParams.toString());
      p.set("w", pick);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    }
  }, [warehouses, pathname, router, searchParams]);

  const selectWarehouseTab = useCallback(
    (id: string) => {
      setTabWarehouseId(id);
      try {
        sessionStorage.setItem(TAB_STORAGE_KEY, id);
      } catch {
        void 0;
      }
      const p = new URLSearchParams(searchParams.toString());
      p.set("w", id);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const addStorageZone = useCallback(async () => {
    const name = newZoneName.trim();
    if (!name || addZoneBusy) return;
    setAddZoneBusy(true);
    try {
      const res = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json()) as {
        warehouse?: { id: string };
        error?: string;
      };
      if (!res.ok) return;
      setNewZoneName("");
      await loadZones();
      const nid = json.warehouse?.id;
      if (nid) selectWarehouseTab(nid);
    } finally {
      setAddZoneBusy(false);
    }
  }, [
    addZoneBusy,
    loadZones,
    newZoneName,
    selectWarehouseTab,
  ]);

  const fetchBalance = useCallback(
    async (labelId: string, warehouseId: string) => {
      if (!labelId || !warehouseId) {
        setOnHand(null);
        return;
      }
      setBalanceBusy(true);
      try {
        const u = new URL("/api/inventory/balance", window.location.origin);
        u.searchParams.set("label_record_id", labelId);
        u.searchParams.set("warehouse_id", warehouseId);
        const res = await fetch(u.toString());
        const json = (await res.json()) as { on_hand?: number; error?: string };
        if (!res.ok) throw new Error(json.error || "庫存讀取失敗");
        setOnHand(Number(json.on_hand ?? 0));
      } catch {
        setOnHand(null);
      } finally {
        setBalanceBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    const q = searchParams.get("qr")?.trim();
    if (q) setQrInput(q);
  }, [searchParams]);

  const fetchRecord = useCallback(
    async (qrRaw: string) => {
      const qr = qrRaw.replace(/\uFEFF/g, "").trim();
      setErrorMsg(null);
      setInvMsg(null);
      setRecord(null);
      setFound(null);
      setOnHand(null);
      if (!qr) {
        setErrorMsg("請輸入或貼上 QR／料號");
        return;
      }
      setBusy(true);
      try {
        const u = new URL("/api/label-records/lookup", window.location.origin);
        u.searchParams.set("qr", qr);
        const res = await fetch(u.toString());
        const json = (await res.json()) as {
          found?: boolean;
          record?: LookupRecord;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || `查詢失敗 ${res.status}`);
        }
        setFound(Boolean(json.found));
        if (json.record) setRecord(json.record as LookupRecord);
        setQrInput(qr);
        if (cameraMode) {
          setScanOpen(false);
          stopScanHardware();
          setScanManualInput("");
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "查詢失敗");
      } finally {
        setBusy(false);
      }
    },
    [cameraMode, stopScanHardware],
  );

  const kickDecodeLoop = useCallback(() => {
    const Detector =
      typeof window !== "undefined" ? window.BarcodeDetector : undefined;
    if (!Detector || !videoRef.current) return;
    let det: BarcodeDetector;
    try {
      det = new Detector({ formats: ["qr_code"] });
    } catch {
      try {
        det = new Detector({
          formats: ["qr_code", "code_128", "code_39", "ean_13", "upc_a"],
        });
      } catch {
        return;
      }
    }
    const loop = async () => {
      if (!videoRef.current || !scanningActiveRef.current) return;
      if (busyMirrorRef.current) {
        decodeRafRef.current = requestAnimationFrame(() => void loop());
        return;
      }
      const v = videoRef.current;
      if (v.videoWidth === 0 || v.videoHeight === 0) {
        decodeRafRef.current = requestAnimationFrame(() => void loop());
        return;
      }
      const t = performance.now();
      if (t - lastDetectAtRef.current < 160) {
        decodeRafRef.current = requestAnimationFrame(() => void loop());
        return;
      }
      lastDetectAtRef.current = t;
      try {
        const found = await det.detect(videoRef.current);
        const code = String(found?.[0]?.rawValue ?? "").trim();
        if (code) {
          const now = Date.now();
          const prev = lastScanRef.current;
          if (code === prev.code && now - prev.at < 1800) {
            decodeRafRef.current = requestAnimationFrame(() => void loop());
            return;
          }
          lastScanRef.current = { code, at: now };
          await fetchRecord(code);
          return;
        }
      } catch {
        void 0;
      }
      decodeRafRef.current = requestAnimationFrame(() => void loop());
    };
    void loop();
  }, [fetchRecord]);

  const openFullscreenScan = useCallback(async () => {
    if (busy) return;
    setErrorMsg(null);
    setScanManualInput("");
    scanningActiveRef.current = true;
    setScanOpen(true);
    const Detector =
      typeof window !== "undefined" ? window.BarcodeDetector : undefined;
    if (!Detector) {
      scanningActiveRef.current = false;
      setErrorMsg("此瀏覽器不支援鏡頭解碼，請改用手動貼上。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await new Promise<void>((resolve) => {
          const el = videoRef.current;
          if (!el) {
            resolve();
            return;
          }
          if (el.readyState >= 2) resolve();
          else el.addEventListener("loadeddata", () => resolve(), { once: true });
        });
      }
      kickDecodeLoop();
    } catch {
      scanningActiveRef.current = false;
      setScanOpen(false);
      setErrorMsg("無法啟用相機，請檢查權限或改用手動貼上。");
    }
  }, [busy, kickDecodeLoop]);

  useEffect(() => {
    if (!record?.id || !tabWarehouseId) {
      setOnHand(null);
      return;
    }
    void fetchBalance(record.id, tabWarehouseId);
  }, [record?.id, tabWarehouseId, fetchBalance]);

  useEffect(() => {
    const qr = searchParams.get("qr")?.trim();
    if (!qr) return;
    const key = qr;
    if (autoFetchedKey.current === key) return;
    autoFetchedKey.current = key;
    void fetchRecord(qr);
  }, [searchParams, fetchRecord]);

  const lookup = useCallback(() => {
    void fetchRecord(qrInput);
  }, [fetchRecord, qrInput]);

  const contentsList = useMemo(() => {
    const m = record?.meta;
    if (!m || typeof m !== "object") return [] as { qr_payload?: string }[];
    const c = m.contents;
    if (!Array.isArray(c)) return [];
    return c.filter((x) => x && typeof x === "object") as {
      qr_payload?: string;
    }[];
  }, [record]);

  const detailLines = useMemo(() => {
    if (!record?.meta || typeof record.meta !== "object") return [] as string[];
    const m = record.meta;
    const lines: string[] = [];
    const push = (label: string, val: unknown) => {
      if (val == null || val === "") return;
      const s = String(val).trim();
      if (s) lines.push(`${label}：${s}`);
    };

    const isD = record.label_type === "D";
    if (isD) {
      push("名稱", m.project_name);
      push("描述", m.description);
    } else {
      push("負責人", m.owner_name);
      push("專案", m.project_name);
    }
    if (!isD) {
      push("剩餘數量", m.surplus_qty);
      push("前次操作者", m.previous_operator);
      push("操作單位", m.operation_unit);
      push("描述／備註", m.description);
    }

    const dt = formatCreatedAt(record.created_at);
    if (dt) lines.push(`建檔時間：${dt}`);

    return lines;
  }, [record]);

  const submitInventory = useCallback(
    async (action_type: "inbound" | "pick" | "stocktake") => {
      if (!record) return;
      setInvMsg(null);
      if (!tabWarehouseId) {
        setInvMsg("無分頁");
        return;
      }
      const op = operatorName.trim() || "現場";
      if (action_type !== "stocktake") {
        if (!Number.isFinite(invQty) || invQty <= 0) {
          setInvMsg("數量錯誤");
          return;
        }
      } else if (!Number.isFinite(invQty) || invQty === 0) {
        setInvMsg("盤點數錯誤");
        return;
      }

      setInvBusy(true);
      try {
        const payloadQty =
          action_type === "stocktake"
            ? Math.trunc(invQty)
            : Math.abs(Math.trunc(invQty));
        const res = await fetch("/api/inventory/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label_record_id: record.id ?? "",
            qr_payload: record.qr_payload,
            warehouse_id: tabWarehouseId,
            operator_name: op,
            action_type,
            quantity: payloadQty,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error || "紀錄失敗");
        const labels: Record<string, string> = {
          inbound: "入",
          pick: "出",
          stocktake: "盤",
        };
        setInvMsg(`OK ${labels[action_type]}`);
        if (record.id) void fetchBalance(record.id, tabWarehouseId);
      } catch (e) {
        setInvMsg(e instanceof Error ? e.message : "紀錄失敗");
      } finally {
        setInvBusy(false);
      }
    },
    [
      record,
      tabWarehouseId,
      operatorName,
      invQty,
      fetchBalance,
    ],
  );

  return (
    <div
      className={`text-zinc-950 ${isAssetHub ? "min-h-0 bg-[#FAFDFC]" : "min-h-[100dvh] bg-zinc-100"}`}
    >
      <div
        className={`mx-auto max-w-lg px-4 pb-24 ${isAssetHub ? "pt-2" : "pt-4"}`}
      >
        {!isAssetHub && (
          <div className="mb-3">
            <Link
              href="/"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-xl text-zinc-700 hover:bg-zinc-200/80"
              aria-label="返回"
            >
              ←
            </Link>
          </div>
        )}

        <div className={isAssetHub ? "mt-1" : "mt-2"}>
          {whListBusy && (
            <p className="text-xs font-bold text-zinc-500">…</p>
          )}
          {!whListBusy && (
            <div className="-mx-1 flex gap-2 overflow-x-auto pb-2 pt-1">
              {warehouses.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => selectWarehouseTab(w.id)}
                  className={`shrink-0 rounded-full border-2 px-4 py-3 text-sm font-black shadow-sm transition-colors sm:min-h-[52px] sm:px-5 sm:text-base ${
                    tabWarehouseId === w.id
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          )}
          {isAssetHub && (
            <div className="mt-3 flex gap-2">
              <input
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-900"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                disabled={addZoneBusy || warehouses.length >= 5}
                aria-label="新分頁名稱"
              />
              <button
                type="button"
                disabled={
                  addZoneBusy ||
                  !newZoneName.trim() ||
                  warehouses.length >= 5
                }
                onClick={() => void addStorageZone()}
                className="shrink-0 rounded-xl border-2 border-emerald-600 bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-40"
              >
                新增
              </button>
            </div>
          )}
        </div>

        {currentSiteName ? (
          <div className="mt-3 rounded-xl border border-emerald-400/60 bg-emerald-50/60 px-3 py-2 text-center shadow-sm">
            <span className="text-base font-black text-emerald-950 sm:text-lg">
              {currentSiteName}
            </span>
            {record?.id && tabWarehouseId ? (
              <span className="ml-2 text-base font-black text-emerald-900 sm:text-lg">
                {balanceBusy ? "…" : onHand ?? "—"}
              </span>
            ) : null}
          </div>
        ) : null}

        {cameraMode ? (
          <div className="mt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void openFullscreenScan()}
              className="flex h-28 w-full flex-col items-center justify-center rounded-2xl border-4 border-violet-800 bg-violet-600 text-white shadow-md disabled:opacity-50"
            >
              <span className="text-4xl">⌁</span>
              <span className="mt-1 text-xl font-black">點我掃描</span>
            </button>
            <p className="mt-2 text-center text-[11px] font-bold text-zinc-500">
              與倉管工作台相同：全螢幕相機；亦可關閉後用手動輸入區辨識。
            </p>
          </div>
        ) : null}

        {!cameraMode ? (
          <>
            <label className="mt-6 grid gap-2">
              <span className="sr-only">QR</span>
              <textarea
                className="min-h-[100px] rounded-lg border-2 border-zinc-400 bg-white px-3 py-2 font-mono text-sm font-bold text-zinc-900 shadow-sm"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={lookup}
              className="mt-5 min-h-[52px] w-full rounded-xl border-2 border-zinc-900 bg-zinc-900 text-lg font-black text-white shadow-sm disabled:opacity-50"
            >
              {busy ? "查詢中…" : "辨識"}
            </button>
          </>
        ) : (
          <label className="mt-6 grid gap-2">
            <span className="text-xs font-bold text-zinc-600">
              手動輸入（無需開啟相機）
            </span>
            <textarea
              className="min-h-[88px] rounded-lg border-2 border-zinc-400 bg-white px-3 py-2 font-mono text-sm font-bold text-zinc-900 shadow-sm"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={lookup}
              className="min-h-[48px] w-full rounded-xl border-2 border-zinc-700 bg-white text-base font-black text-zinc-900 disabled:opacity-50"
            >
              {busy ? "查詢中…" : "手動辨識"}
            </button>
          </label>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-xl border-2 border-zinc-800 bg-white px-4 py-3 text-center text-sm font-black text-zinc-900">
            {errorMsg}
          </div>
        )}

        {found === false && !errorMsg && (
          <div className="mt-6 rounded-2xl border-2 border-zinc-400 bg-white p-5 shadow-sm">
            <p className="text-center text-lg font-black text-zinc-900">
              查無紀錄
            </p>
          </div>
        )}

        {record && (
          <section className="mt-6 rounded-2xl border-2 border-zinc-400 bg-white p-5 shadow-md">
            {record.label_type === "D" ? (
              <div className="text-center">
                <p className="whitespace-pre-line text-2xl font-black leading-snug text-zinc-900 sm:text-3xl">
                  {primarySubtitle(record)}
                </p>
                {(() => {
                  const own = String(record.meta?.owner_name ?? "").trim();
                  if (!own) return null;
                  return (
                    <p className="mt-4 text-lg font-bold text-zinc-700">{own}</p>
                  );
                })()}
              </div>
            ) : (
              <>
                <p className="text-center text-3xl font-black leading-tight tracking-tight text-zinc-900 sm:text-4xl">
                  {categoryHeadline(record)}
                </p>
                <div className="mt-5 border-t border-zinc-200 pt-5 text-center">
                  <p className="whitespace-pre-line text-xl font-black leading-snug text-zinc-900 sm:text-2xl">
                    {primarySubtitle(record)}
                  </p>
                </div>
              </>
            )}

            {record && isManageableAsset(record) && (
              <div className="mt-6 space-y-3 border-t border-zinc-300 pt-6">
                <label className="grid gap-1">
                  <span className="sr-only">數量</span>
                  <input
                    type="number"
                    className="min-h-[48px] rounded-lg border-2 border-zinc-400 bg-white px-3 font-bold text-zinc-900"
                    value={invQty}
                    onChange={(e) => setInvQty(Number(e.target.value))}
                    disabled={invBusy}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="sr-only">操作者</span>
                  <input
                    className="min-h-[48px] rounded-lg border-2 border-zinc-400 bg-white px-3 font-bold text-zinc-900"
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    disabled={invBusy}
                  />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    disabled={invBusy || !tabWarehouseId}
                    onClick={() => void submitInventory("inbound")}
                    className="min-h-[52px] rounded-xl border-2 border-zinc-900 bg-zinc-900 text-base font-black text-white disabled:opacity-45"
                  >
                    入
                  </button>
                  <button
                    type="button"
                    disabled={invBusy || !tabWarehouseId}
                    onClick={() => void submitInventory("pick")}
                    className="min-h-[52px] rounded-xl border-2 border-zinc-700 bg-white text-base font-black text-zinc-900 disabled:opacity-45"
                  >
                    出
                  </button>
                  <button
                    type="button"
                    disabled={invBusy || !tabWarehouseId}
                    onClick={() => void submitInventory("stocktake")}
                    className="min-h-[52px] rounded-xl border-2 border-zinc-400 bg-zinc-100 text-base font-black text-zinc-900 disabled:opacity-45"
                  >
                    盤
                  </button>
                </div>
                {invMsg && (
                  <p
                    className={`text-center text-sm font-black ${
                      invMsg.startsWith("OK") ? "text-emerald-800" : "text-red-700"
                    }`}
                  >
                    {invMsg}
                  </p>
                )}
              </div>
            )}

            {!isAssetHub ? (
              <div className="mt-6 space-y-3 border-t border-zinc-200 pt-5 text-sm text-zinc-700">
                {detailLines.map((line) => (
                  <p key={line} className="font-semibold leading-relaxed">
                    {line}
                  </p>
                ))}

                {contentsList.length > 0 && (
                  <div>
                    <p className="mb-2 text-base font-black text-zinc-900">
                      內含清單
                    </p>
                    <ol className="list-decimal space-y-2 pl-5 font-mono text-xs font-bold text-zinc-800">
                      {contentsList.map((row, i) => (
                        <li key={`${row.qr_payload}-${i}`} className="break-all">
                          {row.qr_payload ?? "—"}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <p className="break-all font-mono text-[11px] font-semibold text-zinc-500">
                  QR：{record.qr_payload}
                </p>
              </div>
            ) : (
              <p className="mt-4 break-all font-mono text-[10px] font-semibold text-zinc-400">
                {record.qr_payload}
              </p>
            )}
          </section>
        )}
      </div>

      {cameraMode && scanOpen ? (
        <section className="fixed inset-0 z-[90] flex flex-col bg-black">
          <div className="relative min-h-0 flex-1">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full bg-black object-cover"
              playsInline
              muted
              autoPlay
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
              <div className="flex flex-col items-center">
                <div
                  className="relative h-[250px] w-[250px] shrink-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                  aria-hidden
                >
                  <span className="absolute left-0 top-0 h-10 w-10 border-l-[4px] border-t-[4px] border-[#00FF00]" />
                  <span className="absolute right-0 top-0 h-10 w-10 border-r-[4px] border-t-[4px] border-[#00FF00]" />
                  <span className="absolute bottom-0 left-0 h-10 w-10 border-b-[4px] border-l-[4px] border-[#00FF00]" />
                  <span className="absolute bottom-0 right-0 h-10 w-10 border-b-[4px] border-r-[4px] border-[#00FF00]" />
                </div>
                <p className="mt-5 text-center text-sm font-black tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                  請將 QR 碼放入框內
                </p>
              </div>
            </div>
          </div>
          <div className="shrink-0 space-y-2 rounded-t-2xl bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
            {errorMsg ? (
              <p className="rounded-lg bg-amber-50 px-2 py-2 text-center text-xs font-bold text-amber-950">
                {errorMsg}
              </p>
            ) : null}
            <p className="text-center text-[11px] font-bold text-slate-500">
              相機將自動辨識；手動請貼上後按確認（與掃描同一支 API）。
            </p>
            <input
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
              placeholder="手動貼上 QR / 料號"
              value={scanManualInput}
              onChange={(e) => setScanManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchRecord(scanManualInput);
              }}
            />
            <button
              type="button"
              disabled={busy}
              className="h-11 w-full rounded-xl bg-blue-800 text-sm font-black text-white disabled:opacity-50"
              onClick={() => void fetchRecord(scanManualInput)}
            >
              {busy ? "辨識中…" : "確認辨識"}
            </button>
            <button
              type="button"
              onClick={() => {
                setScanOpen(false);
                stopScanHardware();
                setScanManualInput("");
                setErrorMsg(null);
              }}
              className="h-11 w-full rounded-xl bg-slate-800 text-sm font-black text-white"
            >
              關閉
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
