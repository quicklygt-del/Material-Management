"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQrCenterTenant } from "@/lib/qrCenterTenant";
import {
  getDefaultLabelPrefix,
  parseLabelQrPayload,
} from "@/lib/labelEncoding";

const TAB_KEY = "wms-warehouse-tab-v1";
const AXIS_KEY = "field-axis-v1";
const ADMIN_MODE_KEY = "field-admin-mode-v1";
const QR_MAX = 1200;

type MaterialRow = {
  id: string;
  label_type: string;
  item_no: string;
  qr_payload: string;
  color_code: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
};

type LookupRecord = {
  id?: string;
  label_type: string;
  item_no: string;
  qr_payload: string;
  meta: Record<string, unknown> | null;
  manageable_asset?: boolean | null;
};

type LedgerLine = {
  id: string;
  created_at: string;
  summary: string | null;
  quantity_delta: number;
  balance_after: number;
  action_type: string;
  operator_name: string | null;
};

type Zone = { id: string; name: string };

type UniTxKind = "inbound" | "pick" | "stocktake";

const UNI_ACTION_SEGMENT: Record<
  UniTxKind,
  { title: string; segClass: string }
> = {
  inbound: {
    title: "📥 移入／入庫",
    segClass:
      "border-emerald-600 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-300",
  },
  pick: {
    title: "📤 移出／領用",
    segClass:
      "border-purple-600 bg-purple-600 text-white shadow-md ring-2 ring-purple-300",
  },
  stocktake: {
    title: "🔍 盤點校正",
    segClass:
      "border-sky-600 bg-sky-600 text-white shadow-md ring-2 ring-sky-300",
  },
};

function fmtLedgerAction(t: string): string {
  switch (t) {
    case "inbound":
      return "移入";
    case "pick":
      return "移出";
    case "stocktake":
      return "盤點";
    default:
      return t;
  }
}

function isManageable(record: LookupRecord): boolean {
  if (record.manageable_asset === false) return false;
  const m = record.meta;
  if (m && m.manageable_asset === false) return false;
  return record.label_type !== "Q";
}

function isMaterialLedgerType(t: string): boolean {
  return t === "S" || t === "R" || t === "B" || t === "Q";
}

function displayName(m: MaterialRow | LookupRecord | null): string {
  if (!m) return "";
  const meta = m.meta ?? {};
  const n = String(
    (meta as { product_name?: unknown }).product_name ??
      (meta as { description?: unknown }).description ??
      "",
  ).trim();
  return n || String(m.item_no ?? "").trim();
}

function displaySpec(m: LookupRecord | MaterialRow | null): string {
  if (!m) return "";
  const meta = m.meta ?? {};
  const spec = String((meta as { spec?: unknown }).spec ?? "").trim();
  if (spec) return spec;
  const cc = "color_code" in m && m.color_code ? String(m.color_code) : "";
  return cc.trim();
}

function userContent(record: LookupRecord): string {
  const m = record.meta ?? {};
  return String(
    (m as { user_content?: unknown }).user_content ??
      (m as { description?: unknown }).description ??
      (m as { project_name?: unknown }).project_name ??
      "",
  ).trim();
}

function lineSummary(record: LookupRecord): string {
  return (
    userContent(record).trim() || String(record.qr_payload ?? "").trim()
  );
}

function fmtShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return "";
  }
}

/** 單位萬用標籤：D 或資料庫允許之 UNIVERSAL */
function isUniversalLabelType(t: string): boolean {
  return t === "D" || t === "UNIVERSAL";
}

export function OtherOperationArea() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantId } = useQrCenterTenant();
  const companyId = useMemo(
    () => tenantId || getDefaultLabelPrefix(),
    [tenantId],
  );

  const [activeTab, setActiveTab] = useState<"material" | "unit">("material");

  const [materialSearch, setMaterialSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [hits, setHits] = useState<MaterialRow[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<MaterialRow | null>(null);
  const [produceBusy, setProduceBusy] = useState(false);

  const [zones, setZones] = useState<Zone[]>([]);
  const [zBusy, setZBusy] = useState(false);
  const [tabId, setTabId] = useState("");
  const [newUnitName, setNewUnitName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [contentDesc, setContentDesc] = useState("");
  const [produceAction, setProduceAction] = useState<UniTxKind>("pick");
  const [produceQty, setProduceQty] = useState(1);
  const [produceOnHand, setProduceOnHand] = useState(0);
  const [produceUniBusy, setProduceUniBusy] = useState(false);
  const [ledgerLines, setLedgerLines] = useState<LedgerLine[]>([]);
  const [linesBusy, setLinesBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrRaw, setQrRaw] = useState("");
  const [busyLook, setBusyLook] = useState(false);
  const [record, setRecord] = useState<LookupRecord | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const [errLook, setErrLook] = useState<string | null>(null);

  const [balance, setBalance] = useState<number | null>(null);
  const [balBusy, setBalBusy] = useState(false);

  const [invBusy, setInvBusy] = useState(false);
  const [invEcho, setInvEcho] = useState<string | null>(null);
  const [scanToast, setScanToast] = useState<string | null>(null);
  /** 成功入帳後暫停掃描開啟，避免連掃（2.5s） */
  const [scanCoolingDown, setScanCoolingDown] = useState(false);
  const resumeScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [canScan, setCanScan] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);

  const lockedZoneId = useMemo(() => {
    const raw = searchParams.get("unit")?.trim();
    if (!raw || zones.length === 0) return null;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    const byId = zones.find((z) => z.id === decoded);
    if (byId) return byId.id;
    const low = decoded.toLowerCase();
    const byName = zones.find(
      (z) => z.name.trim().toLowerCase() === low,
    );
    return byName?.id ?? null;
  }, [searchParams, zones]);

  const unitLinkMissing = useMemo(() => {
    const raw = searchParams.get("unit")?.trim();
    if (!raw || zones.length === 0 || zBusy) return false;
    return lockedZoneId === null;
  }, [searchParams, zones, lockedZoneId, zBusy]);

  const visibleZones = useMemo(() => {
    if (!lockedZoneId) return zones;
    return zones.filter((z) => z.id === lockedZoneId);
  }, [zones, lockedZoneId]);

  useEffect(() => {
    try {
      const s = sessionStorage.getItem(AXIS_KEY)?.trim();
      if (s === "material" || s === "unit") setActiveTab(s);
    } catch {
      void 0;
    }
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(ADMIN_MODE_KEY) === "1") {
        setAdminMode(true);
      }
    } catch {
      void 0;
    }
  }, []);

  const setAdminModePersist = useCallback((next: boolean) => {
    setAdminMode(next);
    try {
      sessionStorage.setItem(ADMIN_MODE_KEY, next ? "1" : "0");
    } catch {
      void 0;
    }
  }, []);

  const persistAxis = useCallback(
    (next: "material" | "unit") => {
      if (lockedZoneId) return;
      if (next === "material") {
        setScanOpen(false);
        if (resumeScanTimerRef.current) {
          clearTimeout(resumeScanTimerRef.current);
          resumeScanTimerRef.current = null;
        }
        setScanCoolingDown(false);
        setScanToast(null);
      }
      setActiveTab(next);
      setRecord(null);
      setFound(null);
      setQrRaw("");
      setErrLook(null);
      setInvEcho(null);
      setBalance(null);
      try {
        sessionStorage.setItem(AXIS_KEY, next);
      } catch {
        void 0;
      }
    },
    [lockedZoneId],
  );

  useEffect(() => {
    if (!lockedZoneId) return;
    setActiveTab("unit");
    try {
      sessionStorage.setItem(AXIS_KEY, "unit");
    } catch {
      void 0;
    }
  }, [lockedZoneId]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(materialSearch.trim()), 240);
    return () => window.clearTimeout(t);
  }, [materialSearch]);

  useEffect(() => {
    setPicked(null);
  }, [debouncedQ]);

  useEffect(() => {
    setCanScan(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    if (searchParams.get("camera") !== "1") return;
    setScanOpen(true);
    const q = new URLSearchParams(searchParams.toString());
    q.delete("camera");
    const s = q.toString();
    router.replace(s ? `/field?${s}` : "/field", { scroll: false });
  }, [router, searchParams]);

  const normalizedQuery = debouncedQ.trim();

  const effectiveRow = useMemo(() => {
    if (picked) return picked;
    if (!hits.length) return null;
    const low = normalizedQuery.toLowerCase();
    const exact = hits.find(
      (h) => h.item_no.trim().toLowerCase() === low,
    );
    return exact ?? hits[0];
  }, [picked, hits, normalizedQuery]);

  const previewPayload = useMemo(() => {
    const fromRow = effectiveRow?.item_no.trim();
    if (fromRow) return fromRow.slice(0, QR_MAX);
    return normalizedQuery.slice(0, QR_MAX);
  }, [effectiveRow, normalizedQuery]);

  const previewProductLine = useMemo(() => {
    if (searchBusy) return "";
    if (effectiveRow) {
      const name = displayName(effectiveRow);
      return name || effectiveRow.item_no;
    }
    if (normalizedQuery && !hits.length) return "尚未對應建檔資料";
    return "";
  }, [effectiveRow, normalizedQuery, hits.length, searchBusy]);

  const materialKeyForRecord = useCallback((r: LookupRecord): string => {
    return String(r.item_no ?? "").trim();
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
    if (zones.length === 0) {
      setTabId("");
      return;
    }
    if (lockedZoneId && zones.some((z) => z.id === lockedZoneId)) {
      setTabId(lockedZoneId);
      return;
    }
    setTabId((prev) => {
      if (prev && zones.some((z) => z.id === prev)) return prev;
      try {
        const s =
          typeof window !== "undefined"
            ? sessionStorage.getItem(TAB_KEY)?.trim()
            : "";
        if (s && zones.some((z) => z.id === s)) return s;
      } catch {
        void 0;
      }
      return zones[0].id;
    });
  }, [zones, lockedZoneId]);

  useEffect(() => {
    try {
      if (tabId) sessionStorage.setItem(TAB_KEY, tabId);
    } catch {
      void 0;
    }
  }, [tabId]);

  const loadLedgerLines = useCallback(async () => {
    if (!companyId || !tabId || activeTab !== "unit") return;
    setLinesBusy(true);
    try {
      const u = new URL("/api/universal-ledger/lines", window.location.origin);
      u.searchParams.set("tenant", companyId);
      u.searchParams.set("unit_id", tabId);
      const res = await fetch(u.toString());
      const json = (await res.json()) as {
        lines?: LedgerLine[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "讀取失敗");
      setLedgerLines(json.lines ?? []);
    } catch {
      setLedgerLines([]);
    } finally {
      setLinesBusy(false);
    }
  }, [activeTab, companyId, tabId]);

  useEffect(() => {
    void loadLedgerLines();
  }, [loadLedgerLines]);

  const fetchMatBalance = useCallback(
    async (materialItemNo: string) => {
      if (!materialItemNo || !companyId) {
        setBalance(null);
        return;
      }
      setBalBusy(true);
      try {
        const u = new URL("/api/material/balance", window.location.origin);
        u.searchParams.set("tenant", companyId);
        u.searchParams.set("material_item_no", materialItemNo);
        const res = await fetch(u.toString());
        const json = (await res.json()) as { on_hand?: number; error?: string };
        if (!res.ok) throw new Error(json.error ?? "錯誤");
        setBalance(Number(json.on_hand ?? 0));
      } catch {
        setBalance(null);
      } finally {
        setBalBusy(false);
      }
    },
    [companyId],
  );

  const fetchUniBalance = useCallback(
    async (labelRecordId: string, unitId: string) => {
      if (!labelRecordId || !unitId || !companyId) {
        setBalance(null);
        return;
      }
      setBalBusy(true);
      try {
        const u = new URL(
          "/api/universal-ledger/balance",
          window.location.origin,
        );
        u.searchParams.set("tenant", companyId);
        u.searchParams.set("unit_id", unitId);
        u.searchParams.set("label_record_id", labelRecordId);
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
    [companyId],
  );

  useEffect(() => {
    if (!record?.id) {
      setBalance(null);
      return;
    }
    if (activeTab === "material" && isMaterialLedgerType(record.label_type)) {
      void fetchMatBalance(materialKeyForRecord(record));
      return;
    }
    if (
      activeTab === "unit" &&
      isUniversalLabelType(record.label_type) &&
      tabId
    ) {
      void fetchUniBalance(record.id, tabId);
      return;
    }
    setBalance(null);
  }, [
    activeTab,
    fetchMatBalance,
    fetchUniBalance,
    materialKeyForRecord,
    record,
    tabId,
  ]);

  const runSearch = useCallback(async () => {
    setSearchErr(null);
    if (!normalizedQuery || !companyId) {
      setHits([]);
      return;
    }
    setSearchBusy(true);
    try {
      const u = new URL("/api/materials/search", window.location.origin);
      u.searchParams.set("tenant", companyId);
      u.searchParams.set("q", normalizedQuery);
      const res = await fetch(u.toString());
      const json = (await res.json()) as {
        materials?: MaterialRow[];
        error?: string;
      };
      if (!res.ok) {
        setHits([]);
        setSearchErr(json.error ?? "搜尋失敗");
        return;
      }
      setHits(json.materials ?? []);
    } catch {
      setHits([]);
      setSearchErr("搜尋失敗");
    } finally {
      setSearchBusy(false);
    }
  }, [companyId, normalizedQuery]);

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const postMaterialLedgerTx = useCallback(
    async (
      rec: LookupRecord,
      kind: "inbound" | "pick" | "stocktake",
    ): Promise<boolean> => {
      setInvEcho(null);
      if (!companyId || !isMaterialLedgerType(rec.label_type)) return false;
      const material_item_no = materialKeyForRecord(rec);
      if (!material_item_no) return false;
      if (kind !== "stocktake") {
        if (!Number.isFinite(produceQty) || produceQty <= 0) {
          setInvEcho("數量無效");
          return false;
        }
      } else if (!Number.isFinite(produceOnHand) || produceOnHand === 0) {
        setInvEcho("數量無效");
        return false;
      }
      const qv =
        kind === "stocktake"
          ? Math.trunc(produceOnHand)
          : Math.abs(Math.trunc(produceQty));
      setInvBusy(true);
      try {
        const res = await fetch("/api/material/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            : companyId,
            material_item_no,
            label_record_id: rec.id ?? "",
            operator_name: "現場",
            action_type: kind,
            quantity: qv,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "失敗");
        void fetchMatBalance(material_item_no);
        return true;
      } catch (e) {
        setInvEcho(e instanceof Error ? e.message : "失敗");
        return false;
      } finally {
        setInvBusy(false);
      }
    },
    [
      companyId,
      fetchMatBalance,
      materialKeyForRecord,
      produceOnHand,
      produceQty,
    ],
  );

  const postUniversalLedgerTx = useCallback(
    async (rec: LookupRecord, kind: UniTxKind): Promise<boolean> => {
      setInvEcho(null);
      if (!companyId || !rec.id || !tabId) return false;
      if (kind !== "stocktake") {
        if (!Number.isFinite(produceQty) || produceQty <= 0) {
          setInvEcho("數量無效");
          return false;
        }
      } else if (!Number.isFinite(produceOnHand)) {
        setInvEcho("請填現存數量（整數）");
        return false;
      }
      const qv =
        kind === "stocktake"
          ? Math.trunc(produceOnHand)
          : Math.trunc(produceQty);
      setInvBusy(true);
      try {
        const sumPrefix =
          kind === "inbound"
            ? "【📥 移入／入庫】"
            : kind === "pick"
              ? "【📤 移出／領用】"
              : "【🔍 盤點校正】";
        const summaryPayload =
          `${sumPrefix} ${lineSummary(rec)}`.trim().slice(0, 2000);

        const res = await fetch("/api/universal-ledger/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            : companyId,
            unit_id: tabId,
            label_record_id: rec.id,
            qr_payload: rec.qr_payload,
            summary: summaryPayload,
            operator_name: "現場",
            action_type: kind,
            quantity: qv,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "失敗");
        void fetchUniBalance(rec.id, tabId);
        await loadLedgerLines();
        return true;
      } catch (e) {
        setInvEcho(e instanceof Error ? e.message : "失敗");
        return false;
      } finally {
        setInvBusy(false);
      }
    },
    [
      companyId,
      fetchUniBalance,
      loadLedgerLines,
      produceOnHand,
      produceQty,
      tabId,
    ],
  );

  const resumeScanAfterSuccess = useCallback((postedLabel: string) => {
    if (resumeScanTimerRef.current) {
      clearTimeout(resumeScanTimerRef.current);
      resumeScanTimerRef.current = null;
    }
    setRecord(null);
    setFound(null);
    setQrRaw("");
    setErrLook(null);
    setInvEcho(null);
    setScanToast(`✅ 已入帳：${postedLabel}`);
    setScanCoolingDown(true);
    resumeScanTimerRef.current = setTimeout(() => {
      resumeScanTimerRef.current = null;
      setScanToast(null);
      setScanCoolingDown(false);
      setScanOpen(true);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeScanTimerRef.current) {
        clearTimeout(resumeScanTimerRef.current);
      }
    };
  }, []);

  const fetchRecord = useCallback(
    async (rawIn: string) => {
      const raw = rawIn.replace(/\uFEFF/g, "").trim();
      setErrLook(null);
      setInvEcho(null);
      setScanToast(null);
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
        const found = Boolean(json.found);
        const rec = json.record ?? null;
        setFound(found);
        setRecord(rec);
        setQrRaw(raw);

        if (!found || !rec || !isManageable(rec)) return;

        const wrongTab =
          activeTab === "material"
            ? !isMaterialLedgerType(rec.label_type)
            : !isUniversalLabelType(rec.label_type);
        if (wrongTab) return;

        const postedLabel =
          displayName(rec) ||
          String(rec.item_no ?? "").trim() ||
          lineSummary(rec).slice(0, 48);

        if (activeTab === "material" && isMaterialLedgerType(rec.label_type)) {
          const ok = await postMaterialLedgerTx(rec, produceAction);
          if (ok) resumeScanAfterSuccess(postedLabel);
          return;
        }
        if (
          activeTab === "unit" &&
          isUniversalLabelType(rec.label_type) &&
          tabId
        ) {
          const ok = await postUniversalLedgerTx(rec, produceAction);
          if (ok) resumeScanAfterSuccess(postedLabel);
        }
      } catch (e) {
        setErrLook(e instanceof Error ? e.message : "錯誤");
      } finally {
        setBusyLook(false);
      }
    },
    [
      activeTab,
      companyId,
      postMaterialLedgerTx,
      postUniversalLedgerTx,
      produceAction,
      resumeScanAfterSuccess,
      tabId,
    ],
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
      const el = videoRef.current;
      if (stopped || !el) return;
      try {
        const codes = await detector.detect(el);
        const raw = codes[0]?.rawValue?.trim();
        if (raw) {
          stopped = true;
          stream?.getTracks().forEach((t) => t.stop());
          void fetchRecord(raw);
          setScanOpen(false);
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

  const itemNoToProduce = previewPayload;

  const produceLabel = useCallback(async () => {
    const itemNo = itemNoToProduce.trim();
    if (!companyId || !itemNo || produceBusy) return;
    setProduceBusy(true);
    try {
      const metaFrom =
        effectiveRow ??
        ({
          item_no: itemNo,
          meta: {},
        } as MaterialRow);
      const m = metaFrom.meta ?? {};
      const res = await fetch("/api/label-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          : companyId,
          label_type: "S",
          qr_payload: itemNo,
          item_no: itemNo,
          color_code: metaFrom.color_code ?? null,
          operator_id: "material_axis",
          meta: {
            workflow_mode: "material_plain_uid",
            product_name:
              (m as { product_name?: string }).product_name ??
              (m as { description?: string }).description ??
              null,
            spec: (m as { spec?: string }).spec ?? null,
            description: (m as { description?: string }).description ?? null,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "存檔失敗");
    } catch (e) {
      setErrLook(e instanceof Error ? e.message : "存檔失敗");
    } finally {
      setProduceBusy(false);
    }
  }, [companyId, effectiveRow, itemNoToProduce, produceBusy]);

  const produceUniversal = useCallback(async () => {
    const note = contentDesc.trim().slice(0, QR_MAX);
    if (!companyId || !note || !tabId || produceUniBusy) return;
    if (produceAction !== "stocktake") {
      if (!Number.isFinite(produceQty) || produceQty <= 0) {
        setErrLook("移入／移出請填正整數數量");
        return;
      }
    } else if (!Number.isFinite(produceOnHand)) {
      setErrLook("盤點請填有效整數（現存數量）");
      return;
    }
    const ledger_qty =
      produceAction === "stocktake" ? produceOnHand : produceQty;
    setProduceUniBusy(true);
    try {
      const res = await fetch("/api/label-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          : companyId,
          label_type: "UNIVERSAL",
          qr_payload: note,
          item_no: note,
          color_code: null,
          operator_id: "universal_ledger",
          meta: {
            workflow_mode: "universal_unit_ledger",
            unit_id: tabId,
            user_content: note,
            ledger_action: produceAction,
            ledger_qty,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "存檔失敗");
      setContentDesc("");
      void loadLedgerLines();
    } catch (e) {
      setErrLook(e instanceof Error ? e.message : "產製失敗");
    } finally {
      setProduceUniBusy(false);
    }
  }, [
    companyId,
    contentDesc,
    loadLedgerLines,
    produceAction,
    produceOnHand,
    produceQty,
    produceUniBusy,
    tabId,
  ]);

  const downloadBinCard = useCallback(async () => {
    if (!companyId || !tabId || exportBusy) return;
    setExportBusy(true);
    try {
      const u = new URL("/api/universal-ledger/export", window.location.origin);
      u.searchParams.set("tenant", companyId);
      u.searchParams.set("unit_id", tabId);
      u.searchParams.set("format", "xlsx");
      const res = await fetch(u.toString());
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "下載失敗");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      let fname = `物料卡_${tabId.slice(0, 8)}.xlsx`;
      const m = cd?.match(/filename="?([^";]+)"?/i);
      if (m?.[1]) fname = decodeURIComponent(m[1]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErrLook(e instanceof Error ? e.message : "下載失敗");
    } finally {
      setExportBusy(false);
    }
  }, [companyId, exportBusy, tabId]);

  const handleAddUnit = useCallback(async () => {
    const n = newUnitName.trim();
    if (!n || !companyId || addBusy || zones.length >= 5) return;
    setAddBusy(true);
    try {
      const res = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, : companyId }),
      });
      const json = (await res.json()) as { warehouse?: { id: string } };
      if (!res.ok) return;
      const newId = json.warehouse?.id;
      setNewUnitName("");
      setContentDesc("");
      await loadZones();
      if (newId) {
        setTabId(newId);
        try {
          sessionStorage.setItem(TAB_KEY, newId);
        } catch {
          void 0;
        }
      }
    } finally {
      setAddBusy(false);
    }
  }, [addBusy, companyId, loadZones, newUnitName, zones.length]);

  const deleteZone = useCallback(
    async (id: string, name: string) => {
      if (!companyId || !adminMode) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm(`確定刪除管理單位「${name}」？`)
      ) {
        return;
      }
      try {
        const u = new URL("/api/warehouses", window.location.origin);
        u.searchParams.set("id", id);
        u.searchParams.set("tenant", companyId);
        const res = await fetch(u.toString(), { method: "DELETE" });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "刪除失敗");
        if (tabId === id) setTabId("");
        await loadZones();
      } catch (e) {
        setErrLook(e instanceof Error ? e.message : "刪除失敗");
      }
    },
    [adminMode, companyId, loadZones, tabId],
  );

  const pickUnitTab = useCallback((id: string) => {
    if (resumeScanTimerRef.current) {
      clearTimeout(resumeScanTimerRef.current);
      resumeScanTimerRef.current = null;
    }
    setScanCoolingDown(false);
    setScanToast(null);
    setTabId(id);
    setFound(null);
    setRecord(null);
    setQrRaw("");
    setErrLook(null);
    setInvEcho(null);
  }, []);

  const openScanFlow = useCallback(() => {
    setQrRaw("");
    setErrLook(null);
    setScanOpen(true);
  }, []);

  const closeScanFlow = useCallback(() => {
    setScanOpen(false);
  }, []);

  const serialLine = useMemo(() => {
    if (!qrRaw) return "";
    const p = parseLabelQrPayload(qrRaw);
    return p?.serial ? `${p.prefix}-${p.typeCode}-${p.serial}` : qrRaw;
  }, [qrRaw]);

  const wrongAxis = useMemo(() => {
    if (!record) return false;
    if (activeTab === "material") return !isMaterialLedgerType(record.label_type);
    return !isUniversalLabelType(record.label_type);
  }, [activeTab, record]);

  const showBigScan = true;

  const clearRecognition = useCallback(() => {
    if (resumeScanTimerRef.current) {
      clearTimeout(resumeScanTimerRef.current);
      resumeScanTimerRef.current = null;
    }
    setScanCoolingDown(false);
    setRecord(null);
    setFound(null);
    setQrRaw("");
    setErrLook(null);
    setInvEcho(null);
    setScanToast(null);
  }, []);

  const selectedZoneName = zones.find((z) => z.id === tabId)?.name ?? "";
  const qrPreviewUnit = contentDesc.trim().slice(0, QR_MAX);
  const scanReady = zones.length > 0;

  return (
    <div
      className={`mx-auto min-h-screen max-w-md bg-gray-50 font-sans text-zinc-900 ${
        activeTab === "unit"
          ? "pb-[calc(7rem+env(safe-area-inset-bottom))]"
          : "pb-[calc(8rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {scanToast ? (
        <div className="fixed left-0 right-0 top-0 z-[110] border-b border-emerald-700/60 bg-emerald-900 px-3 py-2 pt-[max(0.55rem,env(safe-area-inset-top))] text-center text-sm font-black leading-snug text-white shadow-lg">
          {scanToast}
        </div>
      ) : null}
      {unitLinkMissing ? (
        <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-900">
          網址參數之單位找不到，已顯示全部管理單位供選擇。
        </p>
      ) : null}
      {lockedZoneId ? (
        <p className="border-b border-purple-200 bg-purple-50 px-3 py-2 text-center text-xs font-bold text-purple-900">
          連結鎖定：僅「{selectedZoneName || "—"}」— 已隱藏其他單位以免誤觸扣帳
        </p>
      ) : null}
      <div className="flex items-stretch gap-2 bg-white p-3 shadow-sm">
        {lockedZoneId ? (
          <div className="flex min-w-0 flex-1 items-center px-1">
            <p className="text-sm font-bold leading-snug text-purple-900">
              單位萬用作業
              <span className="ml-1 text-xs font-normal text-purple-700">
                （URL 已鎖定，無法切物料／其他單位）
              </span>
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 gap-2">
            <button
              type="button"
              onClick={() => persistAxis("material")}
              className={`flex-1 rounded-xl p-3 font-bold transition ${
                activeTab === "material"
                  ? "bg-green-700 text-white shadow-lg"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              物料標籤區
              <br />
              <span className="text-xs font-normal">(主軸：Excel)</span>
            </button>
            <button
              type="button"
              onClick={() => persistAxis("unit")}
              className={`flex-1 rounded-xl p-3 font-bold transition ${
                activeTab === "unit"
                  ? "bg-purple-600 text-white shadow-lg"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              單位萬用區
              <br />
              <span className="text-xs font-normal">(附加：自定義)</span>
            </button>
          </div>
        )}
        {!lockedZoneId ? (
          <div className="flex w-[5.5rem] shrink-0 flex-col items-center justify-center border-l border-gray-200 pl-2">
            <span className="text-center text-[9px] font-bold leading-tight text-gray-600">
              ⚙ 管理模式
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={adminMode}
              onClick={() => setAdminModePersist(!adminMode)}
              className={`mt-1 flex h-7 w-full items-center rounded-full px-1 text-[10px] font-black transition ${
                adminMode
                  ? "justify-end bg-purple-600 text-white"
                  : "justify-start bg-gray-200 text-gray-600"
              }`}
            >
              <span className="rounded-full bg-white px-1.5 py-0.5 shadow">
                {adminMode ? "開" : "關"}
              </span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-6 p-4">
        {activeTab === "material" && (
          <section className="rounded-2xl border-t-4 border-green-700 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-green-800">
              物料主帳管理
            </h2>
            <input
              className="mb-4 w-full rounded-lg border-2 p-3 outline-none focus:border-green-700"
              placeholder="輸入料號，即時產製 QR…"
              value={materialSearch}
              onChange={(e) => setMaterialSearch(e.target.value)}
              autoComplete="off"
            />

            {searchErr ? (
              <p className="mb-2 text-center text-xs font-bold text-red-600">
                {searchErr}
              </p>
            ) : null}

            {hits.length > 1 ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {hits.slice(0, 8).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setPicked(h)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                      (picked?.id ?? effectiveRow?.id) === h.id
                        ? "border-green-700 bg-green-700 text-white"
                        : "border-zinc-300 bg-zinc-50 text-zinc-800"
                    }`}
                  >
                    {h.item_no}
                  </button>
                ))}
              </div>
            ) : null}

            {materialSearch.trim() ? (
              <div className="flex flex-col items-center rounded-xl bg-green-50 p-6">
                <QRCodeSVG value={previewPayload} size={160} level="M" />
                <p className="mt-4 font-mono text-xl font-bold">
                  {previewPayload}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {searchBusy ? "讀取中…" : previewProductLine || "自動抓取之品名規格將顯示於此"}
                </p>
                {effectiveRow && displaySpec(effectiveRow) ? (
                  <p className="mt-0.5 text-xs font-bold text-gray-500">
                    規格 {displaySpec(effectiveRow)}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={!itemNoToProduce.trim() || produceBusy}
                  onClick={() => void produceLabel()}
                  className="mt-4 w-full rounded-lg bg-green-700 py-3 font-bold text-white disabled:opacity-40"
                >
                  {produceBusy ? "處理中…" : "列印此標籤"}
                </button>
              </div>
            ) : null}
          </section>
        )}

        {activeTab === "unit" && (
          <section className="rounded-2xl border-t-4 border-purple-600 bg-white p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-bold text-purple-800">
              {adminMode ? "管理模式 · 數位物料卡" : "現場快掃"}
            </h2>
            {!adminMode ? (
              <p className="mb-4 text-xs font-medium text-purple-900/85">
                選擇單位後點右下角掃描 · 頂端切換入庫／領用／盤點與數量
              </p>
            ) : null}

            <div className="mb-4 flex flex-wrap gap-2">
              {zBusy ? (
                <span className="py-1 text-xs text-slate-500">載入單位…</span>
              ) : (
                visibleZones.map((u) => (
                  <div key={u.id} className="inline-flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => pickUnitTab(u.id)}
                      className={`rounded-full border px-4 py-1 ${
                        tabId === u.id
                          ? "border-purple-600 bg-purple-600 text-white"
                          : "border-purple-600 bg-white text-purple-600"
                      }`}
                    >
                      {u.name}
                    </button>
                    {adminMode ? (
                      <button
                        type="button"
                        title="刪除此單位"
                        onClick={() => void deleteZone(u.id, u.name)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-black text-red-600 hover:bg-red-50"
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                ))
              )}
              {adminMode && !lockedZoneId ? (
                <div className="mt-2 flex w-full gap-1">
                  <input
                    className="flex-1 rounded-lg border p-2 text-sm"
                    placeholder="新增單位…"
                    value={newUnitName}
                    onChange={(e) => setNewUnitName(e.target.value)}
                    disabled={zones.length >= 5 || addBusy}
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddUnit()}
                    disabled={
                      !newUnitName.trim() || addBusy || zones.length >= 5
                    }
                    className="rounded-lg bg-purple-600 px-4 text-sm text-white disabled:opacity-40"
                  >
                    {addBusy ? "…" : "新增"}
                  </button>
                </div>
              ) : null}
            </div>

            {adminMode ? (
              <>
                <hr className="my-4" />

                <div className="space-y-4">
                  <label className="text-sm font-bold text-gray-600">
                    內容說明 (QR 即此文字)
                  </label>
                  <textarea
                    className="w-full rounded-lg border-2 p-3 outline-none focus:border-purple-600"
                    rows={2}
                    placeholder={`正在為「${selectedZoneName || "…"}」編寫標籤…`}
                    value={contentDesc}
                    onChange={(e) => setContentDesc(e.target.value)}
                    disabled={produceUniBusy || !scanReady}
                  />

                  <p className="text-xs font-bold text-gray-500">作業分類</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        "inbound",
                        "pick",
                        "stocktake",
                      ] as const
                    ).map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={produceUniBusy || !scanReady}
                        onClick={() => setProduceAction(k)}
                        className={`rounded-xl border-2 py-2.5 text-center text-[11px] font-black leading-tight transition ${
                          produceAction === k
                            ? UNI_ACTION_SEGMENT[k].segClass
                            : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {UNI_ACTION_SEGMENT[k].title}
                      </button>
                    ))}
                  </div>

                  {produceAction !== "stocktake" ? (
                    <label className="block text-xs font-bold text-gray-600">
                      數量（移入為正、移出將存為負向異動）
                      <input
                        type="number"
                        min={1}
                        className="mt-1 w-full rounded-lg border-2 border-gray-200 p-2 text-center text-lg font-black"
                        value={produceQty}
                        onChange={(e) =>
                          setProduceQty(Number(e.target.value))
                        }
                        disabled={produceUniBusy || !scanReady}
                      />
                    </label>
                  ) : (
                    <label className="block text-xs font-bold text-gray-600">
                      現存數量（盤點校正，系統自動計算調整量）
                      <input
                        type="number"
                        className="mt-1 w-full rounded-lg border-2 border-sky-200 p-2 text-center text-lg font-black"
                        value={produceOnHand}
                        onChange={(e) =>
                          setProduceOnHand(Number(e.target.value))
                        }
                        disabled={produceUniBusy || !scanReady}
                      />
                    </label>
                  )}

                  {qrPreviewUnit ? (
                    <div
                      className={`flex flex-col items-center rounded-xl p-4 ${
                        produceAction === "inbound"
                          ? "bg-emerald-50"
                          : produceAction === "pick"
                            ? "bg-purple-50"
                            : "bg-sky-50"
                      }`}
                    >
                      <p className="mb-2 text-center text-xs font-black text-zinc-700">
                        本筆：
                        {produceAction === "inbound"
                          ? "移入／入庫"
                          : produceAction === "pick"
                            ? "移出／領用"
                            : "盤點校正"}
                        （寫入明細與匯出均帶此分類）
                      </p>
                      <QRCodeSVG value={qrPreviewUnit} size={120} level="M" />
                      <button
                        type="button"
                        disabled={
                          !qrPreviewUnit || produceUniBusy || !tabId
                        }
                        onClick={() => void produceUniversal()}
                        className={`mt-4 w-full rounded-lg py-3 font-bold text-white disabled:opacity-40 ${
                          produceAction === "inbound"
                            ? "bg-emerald-600"
                            : produceAction === "pick"
                              ? "bg-purple-600"
                              : "bg-sky-600"
                        }`}
                      >
                        {produceUniBusy
                          ? "處理中…"
                          : `產製標籤（${produceAction === "inbound" ? "移入" : produceAction === "pick" ? "移出" : "盤點"}）`}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-8">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-gray-700">
                      【{selectedZoneName || "—"}】異動明細
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLedgerExpanded((v) => !v)}
                        className="text-xs font-bold text-purple-700 underline"
                      >
                        {ledgerExpanded
                          ? "收合異動明細"
                          : `展開異動明細${ledgerLines.length ? `（${ledgerLines.length}）` : ""}`}
                      </button>
                      <button
                        type="button"
                        disabled={!tabId || exportBusy}
                        onClick={() => void downloadBinCard()}
                        className="rounded bg-gray-200 px-2 py-1 text-xs disabled:opacity-40"
                      >
                        {exportBusy ? "…" : "💾 下載 Excel"}
                      </button>
                    </div>
                  </div>
                  {ledgerExpanded ? (
                    <div className="max-h-[min(38vh,14rem)] overflow-y-auto overflow-x-auto rounded-lg border sm:max-h-52 md:max-h-60">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-gray-100">
                          <tr>
                            <th className="p-2">類別</th>
                            <th className="p-2">摘要</th>
                            <th className="p-2">±</th>
                            <th className="p-2">結餘</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linesBusy ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="p-4 text-center text-gray-500"
                              >
                                讀取中…
                              </td>
                            </tr>
                          ) : ledgerLines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="p-4 text-center text-gray-400"
                              >
                                尚無異動紀錄
                              </td>
                            </tr>
                          ) : (
                            ledgerLines.map((row) => (
                              <tr key={row.id} className="border-t">
                                <td className="p-2 font-bold text-zinc-800">
                                  {fmtLedgerAction(row.action_type)}
                                </td>
                                <td className="p-2">
                                  <div className="text-[10px] text-gray-400">
                                    {fmtShortDate(row.created_at)}
                                  </div>
                                  <div>{row.summary ?? "—"}</div>
                                </td>
                                <td
                                  className={`p-2 font-bold ${
                                    row.quantity_delta > 0
                                      ? "text-green-600"
                                      : row.quantity_delta < 0
                                        ? "text-red-600"
                                        : "text-gray-600"
                                  }`}
                                >
                                  {row.quantity_delta > 0
                                    ? `+${row.quantity_delta}`
                                    : row.quantity_delta}
                                </td>
                                <td className="p-2 font-bold">
                                  {row.balance_after}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-3 text-center text-xs text-gray-500">
                      異動明細已收合，請手動展開查看
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </section>
        )}
      </div>

      {scanOpen && activeTab === "unit" ? (
        <div
          role="dialog"
          aria-modal
          aria-label="掃描"
          className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-white"
        >
          <div
            className="flex shrink-0 items-start gap-2 px-3 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
          >
            <button
              type="button"
              onClick={() => closeScanFlow()}
              className="shrink-0 rounded-xl bg-white/15 px-3 py-2.5 text-sm font-black text-white backdrop-blur"
            >
              關閉
            </button>
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-1.5">
              {(["inbound", "pick", "stocktake"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={produceUniBusy || busyLook || invBusy}
                  onClick={() => setProduceAction(k)}
                  className={`rounded-xl py-2.5 text-center text-xs font-black ${
                    produceAction === k
                      ? k === "inbound"
                        ? "bg-emerald-400 text-zinc-900 ring-2 ring-white"
                        : k === "pick"
                          ? "bg-purple-400 text-zinc-900 ring-2 ring-white"
                          : "bg-sky-400 text-zinc-900 ring-2 ring-white"
                      : "bg-white/10 text-white/90 ring-1 ring-white/25"
                  }`}
                >
                  {k === "inbound" ? "入庫" : k === "pick" ? "領用" : "盤點"}
                </button>
              ))}
            </div>
          </div>

          <div className="shrink-0 px-4 pb-2">
            {produceAction !== "stocktake" ? (
              <label className="flex items-center gap-3 text-xs font-bold">
                <span className="w-10 shrink-0 text-white/85">數量</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="min-w-0 flex-1 rounded-xl border border-white/25 bg-black/40 px-3 py-2.5 text-center text-xl font-black text-white outline-none focus:border-emerald-400/80"
                  value={produceQty}
                  onChange={(e) => setProduceQty(Number(e.target.value))}
                  disabled={produceUniBusy || busyLook || invBusy}
                />
              </label>
            ) : (
              <label className="flex items-center gap-3 text-xs font-bold">
                <span className="w-24 shrink-0 text-white/85">盤點現存</span>
                <input
                  type="number"
                  inputMode="numeric"
                  className="min-w-0 flex-1 rounded-xl border border-white/25 bg-black/40 px-3 py-2.5 text-center text-xl font-black text-white outline-none focus:border-sky-400/80"
                  value={produceOnHand}
                  onChange={(e) =>
                    setProduceOnHand(Number(e.target.value))
                  }
                  disabled={produceUniBusy || busyLook || invBusy}
                />
              </label>
            )}
          </div>

          {invEcho ? (
            <p className="shrink-0 px-4 pb-2 text-center text-xs font-black text-red-300">
              {invEcho}
            </p>
          ) : null}
          {errLook ? (
            <p className="shrink-0 px-4 pb-2 text-center text-xs font-black text-amber-200">
              {errLook}
            </p>
          ) : null}

          <div className="relative flex min-h-[40vh] flex-1 flex-col items-center justify-center px-6">
            {canScan ? (
              <div className="relative aspect-square w-full max-w-[min(92vw,72vh)] overflow-hidden rounded-2xl bg-black shadow-2xl ring-2 ring-white/20">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                  aria-hidden
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
                  <div className="aspect-square w-[70%] max-w-[18rem] rounded-2xl border-[3px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" />
                </div>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-white/70">
                此裝置不支援鏡頭 QR 掃描
              </p>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-white/15 bg-black/50 px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <textarea
              className="min-h-[4.5rem] w-full resize-none rounded-xl border border-white/25 bg-black/55 px-3 py-2 font-mono text-xs font-bold text-white placeholder:text-white/40"
              placeholder="手動貼上 QR 內容"
              value={qrRaw}
              onChange={(e) => setQrRaw(e.target.value)}
            />
            <button
              type="button"
              disabled={busyLook || !qrRaw.trim()}
              onClick={() => void fetchRecord(qrRaw)}
              className="w-full rounded-xl bg-white py-3 text-sm font-black text-zinc-900 disabled:opacity-40"
            >
              {busyLook ? "…" : "辨識"}
            </button>
          </div>
        </div>
      ) : scanOpen ? (
        <div className="mx-4 mb-4 rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
          {canScan ? (
            <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black">
              <video
                ref={videoRef}
                className="max-h-[11rem] w-full object-cover"
                playsInline
                muted
                aria-hidden
              />
            </div>
          ) : null}
          <textarea
            className="mt-2 min-h-[4rem] w-full resize-none rounded-lg border border-zinc-400 px-3 py-2 font-mono text-xs font-bold"
            placeholder="手動貼上 QR 內容"
            value={qrRaw}
            onChange={(e) => setQrRaw(e.target.value)}
          />
          <button
            type="button"
            disabled={busyLook || !qrRaw.trim()}
            onClick={() => void fetchRecord(qrRaw)}
            className="mt-2 w-full rounded-lg border border-zinc-600 py-2 text-sm font-black"
          >
            {busyLook ? "…" : "辨識"}
          </button>
          <button
            type="button"
            onClick={() => closeScanFlow()}
            className="mt-2 w-full rounded-lg border border-zinc-300 py-2 text-xs font-bold text-zinc-600"
          >
            關閉
          </button>
        </div>
      ) : null}

      {errLook && !(scanOpen && activeTab === "unit") ? (
        <p className="px-4 text-center text-xs font-black text-red-600">
          {errLook}
        </p>
      ) : null}
      {found === false && !errLook ? (
        <p className="px-4 text-center text-sm font-black text-zinc-500">
          查無紀錄
        </p>
      ) : null}
      {wrongAxis && record ? (
        <p className="px-4 text-center text-sm font-black text-amber-800">
          {activeTab === "material"
            ? "此碼屬單位萬用區，請切換上方分類。"
            : "此碼屬物料標籤區，請切換上方分類。"}
        </p>
      ) : null}

      {record && !wrongAxis && activeTab === "material" ? (
        <section className="mx-4 mb-4 rounded-xl border border-zinc-300 bg-white p-4 shadow-md">
          <button
            type="button"
            onClick={clearRecognition}
            className="mb-2 text-xs font-black text-green-800 underline"
          >
            下一筆
          </button>
          <p className="text-center font-mono text-[11px] font-bold text-zinc-500">
            料號 {serialLine.slice(0, 44)}
            {serialLine.length > 44 ? "…" : ""}
          </p>
          <p className="mt-2 text-center text-lg font-black text-zinc-900">
            {displayName(record) || record.item_no}
          </p>
          {displaySpec(record) ? (
            <p className="mt-1 text-center text-sm font-bold text-zinc-600">
              規格 {displaySpec(record)}
            </p>
          ) : null}
          <p className="mt-3 text-center text-xs font-black text-zinc-500">
            庫存
          </p>
          <p className="text-center text-2xl font-black text-green-800">
            {balBusy ? "…" : balance ?? ""}
          </p>
        </section>
      ) : null}

      {record && !wrongAxis && activeTab === "unit" ? (
        <section className="mx-4 mb-4 rounded-xl border border-zinc-300 bg-white p-4 shadow-md">
          <button
            type="button"
            onClick={clearRecognition}
            className="mb-2 text-xs font-black text-purple-700 underline"
          >
            下一筆
          </button>
          <p className="text-center text-xs font-black text-zinc-500">
            可直接入帳，無需再輸入摘要
          </p>
          <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-center text-base font-black leading-snug text-purple-950">
            {lineSummary(record)}
          </p>
          <p className="mt-3 text-center text-xs font-black text-zinc-500">
            結存 {balBusy ? "…" : balance ?? ""}
          </p>
        </section>
      ) : null}

      {showBigScan && activeTab === "material" ? (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-white p-4">
          <button
            type="button"
            disabled={busyLook || invBusy}
            onClick={() => (scanOpen ? closeScanFlow() : openScanFlow())}
            className="w-full rounded-2xl bg-black py-4 text-xl font-black text-white shadow-xl transition active:scale-95 disabled:opacity-40"
          >
            {scanOpen ? "關閉掃描" : "🔍 掃描扣帳"}
          </button>
        </div>
      ) : null}

      {showBigScan && activeTab === "unit" && !scanOpen ? (
        <button
          type="button"
          title="開始掃描"
          aria-label="開始掃描"
          disabled={
            !scanReady || busyLook || invBusy || scanCoolingDown || zBusy
          }
          onClick={() => openScanFlow()}
          className="fixed bottom-[calc(1.1rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex h-[3.7rem] w-[3.7rem] -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-white bg-purple-600 text-[1.65rem] text-white shadow-[0_8px_28px_rgba(0,0,0,.45)] transition active:scale-95 disabled:opacity-40"
        >
          🔍
        </button>
      ) : null}

      {invEcho && !(scanOpen && activeTab === "unit") ? (
        <p
          className={`fixed inset-x-0 z-[38] px-4 text-center text-xs font-black text-red-700 ${
            activeTab === "unit"
              ? "bottom-[calc(5.85rem+env(safe-area-inset-bottom))]"
              : "bottom-[5.5rem]"
          }`}
        >
          {invEcho}
        </p>
      ) : null}
    </div>
  );
}
