"use client";

import Link from "next/link";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { fireWarehouseLedgerPostMove } from "@/lib/warehouseLedger";
import { playErrorBeep, playSuccessBeep } from "@/lib/playBeep";
import { orderGroupKey } from "@/lib/pickingAgg";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { appHref } from "@/lib/appHref";

type PickingTaskRow = {
  id: string;
  order_no: string;
  item_no: string;
  item_name?: string;
  spec?: string;
  unit?: string;
  required_qty: number;
  picked_qty: number;
  status: string;
  /** 僅 stocktake：true = 盲盤 */
  is_blind_count?: boolean;
  assigned_operator: string | null;
  started_at?: string | null;
  operation_type: "inbound" | "outbound" | "stocktake" | "manual";
};

type MatchState = "idle" | "ok" | "bad";

const ITEM_SCAN_FAIL_MSG = "無法取得有效料號，請確認 QR 內容或手動輸入";

/** 提交成功後延遲再跑 UI 重置，減少與擴充套件／事件循環衝突 */
const POST_SUBMIT_UI_RESET_MS = 300;

/** 僅合法的 task UUID 才寫入 task_id；空字串會導致 PostgREST 400 */
function isTaskUuid(raw: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    raw.trim(),
  );
}

/** 掃描對到單據列後開啟 TaskConfirmModal 的上下文 */
type ActiveTaskConfirm = {
  task: PickingTaskRow;
  nfcPayload: string;
  matchedItemDisplay: string;
};

function docTypeSemantic(mode: "inbound" | "outbound" | "stocktake") {
  if (mode === "inbound") return { zh: "入庫", code: "IN", confirmBtn: "確認入庫" };
  if (mode === "stocktake")
    return { zh: "盤點", code: "PK", confirmBtn: "確認盤點" };
  return { zh: "檢貨", code: "AB", confirmBtn: "確認檢貨" };
}

/** 成功提交：直接使用 speechSynthesis（瀏覽器 TTS） */
function speakOperateSuccess(text: string) {
  if (typeof window === "undefined") return;
  try {
    const u = window.speechSynthesis;
    if (!u) return;
    u.cancel();
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = "zh-TW";
    ut.rate = 1;
    u.speak(ut);
  } catch {
    void 0;
  }
}

function normItemNo(s: string) {
  return s.replace(/\uFEFF/g, "").trim();
}

/** QR／手輸內容解析為料號：純字串或常見 URL 查詢參數（item_no / item_no / item / sku / code） */
function parseScanAsItemNo(raw: string): string | null {
  const trimmed = String(raw ?? "").replace(/\uFEFF/g, "").trim();
  if (!trimmed) return null;

  const fromQueryKey = (s: string): string | null => {
    const m =
      /(?:^|[?&#])(?:item_no|item_no|item|sku|code)=([^&#]+)/i.exec(s);
    if (!m?.[1]) return null;
    try {
      const v = decodeURIComponent(m[1].replace(/\+/g, " "));
      const n = normItemNo(v);
      return n.length ? n : null;
    } catch {
      return normItemNo(m[1]) || null;
    }
  };

  const q = fromQueryKey(trimmed);
  if (q) return q;

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      const u = new URL(trimmed);
      const qp =
        u.searchParams.get("item_no") ||
        u.searchParams.get("item_no") ||
        u.searchParams.get("item") ||
        u.searchParams.get("sku") ||
        u.searchParams.get("code");
      if (qp?.trim()) {
        const n = normItemNo(qp);
        if (n) return n;
      }
      const path = u.pathname.replace(/\/+$/, "");
      const seg = path.split("/").filter(Boolean).pop();
      if (seg) {
        const n = normItemNo(decodeURIComponent(seg));
        if (n && !/^index\.(html?|php)$/i.test(n)) return n;
      }
    }
  } catch {
    void 0;
  }

  const direct = normItemNo(trimmed);
  return direct.length ? direct : null;
}

/** 品名＋規格（含 QR 內嵌長字串時給現場辨識） */
function formatItemNameSpecLine(t: PickingTaskRow): string {
  const name = normItemNo(String(t.item_name ?? "")).trim();
  const spec = normItemNo(String(t.spec ?? "")).trim();
  if (name && spec) return `${name} (${spec})`;
  if (name) return name;
  if (spec) return spec;
  return "";
}

/** 從掃描原始字串抽出可能料號（含複合 QR：料號|品名|規格） */
function collectItemCodeCandidates(raw: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const add = (s: string) => {
    const n = normItemNo(s);
    if (!n) return;
    const key = n.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(n);
  };

  const primary = parseScanAsItemNo(raw);
  if (primary) add(primary);
  add(raw);
  for (const part of raw.split(/[\s|;,\t\/]+/)) add(part);

  const codeLike =
    /\b[A-Za-z]{2,}[\w.-]*-[A-Za-z0-9][\w.-]*\b|\b[A-Za-z]\d{2,}[A-Za-z0-9.-]*\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeLike.exec(raw))) add(m[0]);

  return list;
}

function itemNoMatchesTask(taskItem: string, scanned: string): boolean {
  const a = normItemNo(taskItem);
  const b = normItemNo(scanned);
  if (!a || !b) return false;
  return a === b || a.toUpperCase() === b.toUpperCase();
}

function rowOperationMode(
  t: PickingTaskRow,
): "inbound" | "outbound" | "stocktake" {
  const r = t.operation_type;
  if (r === "inbound") return "inbound";
  if (r === "stocktake") return "stocktake";
  return "outbound";
}

function TaskConfirmModal({
  ctx,
  confirmModalQty,
  setConfirmModalQty,
  taskModalErr,
  shortPickPromptOpen,
  onDismissShortPick,
  onConfirmShortPick,
  onClose,
  onPrimarySubmit,
  clearFieldErr,
}: {
  ctx: ActiveTaskConfirm;
  confirmModalQty: string;
  setConfirmModalQty: (s: string) => void;
  taskModalErr: string | null;
  shortPickPromptOpen: boolean;
  onDismissShortPick: () => void;
  onConfirmShortPick: () => void;
  onClose: () => void;
  onPrimarySubmit: () => void;
  clearFieldErr: () => void;
}) {
  const t = ctx.task;
  const mode = rowOperationMode(t);
  const sem = docTypeSemantic(mode);
  const stocktakeBlind = mode === "stocktake" && Boolean(t.is_blind_count);
  const headline =
    mode === "stocktake"
      ? `盤點確認：${normItemNo(t.item_no)}`
      : `物料確認：${normItemNo(t.item_no)}`;
  const pendingNeed = Math.max(t.required_qty - t.picked_qty, 0);

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-4 border-blue-900 bg-white p-5 shadow-xl"
      >
        <h3 className="text-2xl font-black text-slate-900">{headline}</h3>
        <p className="mt-2 text-sm font-black text-slate-600">
          作業類型：{sem.zh}（{sem.code}）
        </p>
        <p className="mt-1 font-bold text-slate-700">
          單號：{normItemNo(t.order_no)}
        </p>
        {formatItemNameSpecLine(t) ? (
          <p className="mt-1 text-lg font-bold text-slate-800">
            {formatItemNameSpecLine(t)}
          </p>
        ) : null}
        {t.unit ? (
          <p className="mt-1 text-sm font-black text-slate-600">單位：{t.unit}</p>
        ) : null}

        {mode === "stocktake" && (
          <div className="mt-4 space-y-2 rounded-xl bg-amber-50 p-3">
            <p className="text-sm font-black text-amber-950">
              盤點模式：{stocktakeBlind ? "盲盤" : "核對"}
              <span className="ml-2 text-xs font-bold text-slate-600">
                （由後台／匯入定義之任務屬性）
              </span>
            </p>
            {!stocktakeBlind ? (
              <p className="text-sm font-bold text-slate-800">
                帳面存量（應盤）：<span className="font-black">{t.required_qty}</span>
                ｜已入帳彙總：<span className="font-black">{t.picked_qty}</span>
              </p>
            ) : (
              <p className="text-sm font-black text-slate-700">
                盲盤：不顯示帳面存量，請依實盤輸入。
              </p>
            )}
          </div>
        )}

        {(mode === "outbound" || mode === "inbound") && (
          <div className="mt-3 space-y-1 text-base font-black text-slate-800">
            <p>
              目標數量：<span className="text-blue-900">{t.required_qty}</span>
              {t.unit ? ` ${t.unit}` : ""}
            </p>
            <p>
              待作業 = 目標數 - 已完成數：<span className="text-blue-900">{pendingNeed}</span>
              {t.unit ? ` ${t.unit}` : ""}
            </p>
          </div>
        )}

        {taskModalErr && (
          <div className="mt-4 rounded-xl border-4 border-red-600 bg-red-50 p-3 text-base font-black text-red-900">
            {taskModalErr}
          </div>
        )}

        <label className="mt-4 block text-lg font-black text-slate-800">
          {mode === "stocktake" ? "實盤數量" : "本次數量"}
          <input
            type="number"
            inputMode="numeric"
            value={confirmModalQty}
            onChange={(e) => {
              clearFieldErr();
              setConfirmModalQty(e.target.value);
            }}
            placeholder={
              mode === "stocktake" && stocktakeBlind
                ? "請輸入實盤數"
                : undefined
            }
            className="mt-2 min-h-[56px] w-full rounded-xl border-2 border-slate-400 px-3 text-2xl font-black"
          />
        </label>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="min-h-[56px] flex-1 rounded-xl bg-slate-300 text-lg font-black text-slate-900 active:scale-[0.99]"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="min-h-[56px] flex-1 rounded-xl bg-blue-800 text-lg font-black text-white active:scale-[0.99]"
            onClick={onPrimarySubmit}
          >
            {sem.confirmBtn}
          </button>
        </div>

        {shortPickPromptOpen && (
          <div className="absolute inset-0 z-10 flex items-end justify-center rounded-2xl bg-black/45 p-3 sm:items-center">
            <div className="w-full max-w-sm rounded-2xl border-4 border-amber-600 bg-white p-5 shadow-2xl">
              <p className="text-center text-xl font-black text-slate-900">
                數量不足，是否結束此品項？
              </p>
              <p className="mt-3 text-center text-sm font-bold text-slate-600">
                若結束：此品項將標記完成（尚可有短少），並寫入日誌。
              </p>
              <button
                type="button"
                className="mt-6 min-h-[56px] w-full rounded-xl bg-slate-200 text-lg font-black text-slate-900 active:scale-[0.99]"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDismissShortPick();
                }}
              >
                否，調整數量
              </button>
              <button
                type="button"
                className="mt-3 min-h-[56px] w-full rounded-xl bg-amber-700 text-lg font-black text-white active:scale-[0.99]"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onConfirmShortPick();
                }}
              >
                結束並提交
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryModal({
  open,
  onClose,
  buckets,
}: {
  open: boolean;
  onClose: () => void;
  buckets: {
    unscanned: PickingTaskRow[];
    withDelta: Array<{ task: PickingTaskRow; delta: number }>;
  };
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-4 sm:items-center">
      <div className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-2xl border-4 border-slate-900 bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-3">
          <h3 className="text-xl font-black text-slate-900">檢視與收尾</h3>
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-lg font-black text-blue-900 underline"
            onClick={onClose}
          >
            關閉
          </button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="border-b-2 border-slate-400 pb-2 text-lg font-black text-red-900">
              未掃描品項（尚無任何掃描彙總）
              <span className="text-sm font-bold text-slate-600">
                （{buckets.unscanned.length} 列）
              </span>
            </h4>
            {buckets.unscanned.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-slate-500">無</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {buckets.unscanned.map((x) => (
                  <li
                    key={`u-${x.id}`}
                    className="rounded-xl border bg-slate-50 p-3 text-sm font-bold"
                  >
                    <div>
                      {normItemNo(x.order_no)} · {x.item_no}
                      {formatItemNameSpecLine(x) ? (
                        <span className="mt-1 block text-base font-black text-slate-800">
                          {formatItemNameSpecLine(x)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1">
                      <span className="font-black text-red-800">
                        應作業 {x.required_qty}／已掃 0
                      </span>
                      <span className="ml-1 text-xs font-black text-slate-600">
                        （
                        {rowOperationMode(x) === "inbound"
                          ? "入庫 IN"
                          : rowOperationMode(x) === "stocktake"
                            ? "盤點 PK"
                            : "檢貨 AB"}
                        ）
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4 className="border-b-2 border-red-700 pb-2 text-lg font-black text-red-900">
              數量有差異品項
              <span className="text-sm font-bold text-slate-700">
                （{buckets.withDelta.length} 列）
              </span>
            </h4>
            {buckets.withDelta.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-slate-500">無</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {buckets.withDelta.map(({ task: x, delta }) => (
                  <li
                    key={`d-${x.id}`}
                    className="rounded-xl border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-950"
                  >
                    <div>
                      {normItemNo(x.order_no)} · {x.item_no}
                      {formatItemNameSpecLine(x) ? (
                        <span className="mt-1 block text-base font-black text-slate-900">
                          {formatItemNameSpecLine(x)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1">
                      <span className="font-black text-red-700">
                        已掃 {x.picked_qty}／應 {x.required_qty}（差異{" "}
                        {delta > 0 ? "+" : ""}
                        {delta}）
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function OperatePageContent() {
  const searchParams = useSearchParams();

  const orderLockKey = useMemo(
    () => (searchParams.get("orderKey") ?? "").trim() || null,
    [searchParams],
  );
  const orderLockNo = useMemo(
    () => (searchParams.get("orderNo") ?? "").trim() || null,
    [searchParams],
  );
  const taskIdFromQuery = useMemo(
    () => (searchParams.get("task") ?? "").trim() || null,
    [searchParams],
  );

  const urlSaysManual = useMemo(
    () =>
      searchParams.get("op") === "manual" ||
      searchParams.get("mode") === "manual",
    [searchParams],
  );

  const [opType, setOpType] = useState<
    | "inbound"
    | "outbound"
    | "stocktake"
    | "manual"
  >("outbound");
  const [sessionName, setSessionName] = useState("");
  const [sessionRole, setSessionRole] = useState<
    "system_admin" | "warehouse_admin" | "warehouse_staff" | "unit" | null
  >(null);
  const [tasks, setTasks] = useState<PickingTaskRow[]>([]);
  /** 與後台一致的單號彙總鍵（trim） */
  const [selectedOrderKey, setSelectedOrderKey] = useState("");
  const [match, setMatch] = useState<MatchState>("idle");
  const [simUid, setSimUid] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [variance, setVariance] = useState<number | null>(null);
  const [manualItemNo, setManualItemNo] = useState<string>("UNKNOWN");
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const handleDecodedScanRef = useRef<(s: string) => Promise<void>>(async () => {});
  /** 避免舊的「延遲釋放 UI」把新一輪掃描的彈窗清掉 */
  const submitConfirmGenRef = useRef(0);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [qrOpen, setQrOpen] = useState(false);
  /** 除錯：最近一次掃描／手輸收到的原始字串與正規比對鍵 */
  /** 不按 Enter 自動載入全表 — 按需載入以省記憶體 */
  const [tasksHydrated, setTasksHydrated] = useState(false);
  const [hydratingTasks, setHydratingTasks] = useState(false);
  const [activeTask, setActiveTask] = useState<ActiveTaskConfirm | null>(null);
  const [confirmModalQty, setConfirmModalQty] = useState("1");
  /** TaskConfirmModal：超量／防呆錯誤（紅色區塊） */
  const [taskModalErr, setTaskModalErr] = useState<string | null>(null);
  /** 檢貨／入庫：本次數 < 尚可數時的二次確認 */
  const [shortPickPromptOpen, setShortPickPromptOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  /** 超量等：頂部紅色 Toast（與 Modal 內欄位錯誤分離） */
  const [dangerToast, setDangerToast] = useState<string | null>(null);

  const isManual = useMemo(
    () => urlSaysManual || opType === "manual",
    [urlSaysManual, opType],
  );

  const hasOrderIntent = useMemo(
    () =>
      isManual ||
      Boolean(orderLockKey) ||
      Boolean(orderLockNo) ||
      Boolean(taskIdFromQuery && isTaskUuid(taskIdFromQuery)),
    [isManual, orderLockKey, orderLockNo, taskIdFromQuery],
  );

  /** 無首頁選單／自主掃描等脈絡時，禁止載入多單並改引導回首頁 */
  const isOrderContextMissing = !hasOrderIntent;

  const vibrate = (ms: number | number[]) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  };

  const stopQrStream = useCallback(() => {
    qrStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    qrStreamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const u = getSessionUser();
      if (u?.username) {
        if (!cancelled) {
          setSessionName(u.username);
          setSessionRole(u.role);
        }
        return;
      }
      try {
        const r = await fetch("/api/unit-portal/session", {
          credentials: "include",
        });
        if (!cancelled && r.ok) {
          const j = (await r.json()) as { portal_login?: string };
          const pl = String(j.portal_login ?? "").trim();
          if (pl) {
            setSessionName(pl);
            setSessionRole("unit");
            return;
          }
        }
      } catch {
        void 0;
      }
      if (!cancelled) {
        setSessionName("unknown");
        setSessionRole(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const raw = searchParams.get("op") || searchParams.get("mode");
    if (
      raw === "inbound" ||
      raw === "stocktake" ||
      raw === "outbound" ||
      raw === "manual"
    ) {
      setOpType(raw);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!dangerToast) return;
    const t = window.setTimeout(() => setDangerToast(null), 4600);
    return () => clearTimeout(t);
  }, [dangerToast]);

  /** 提交成功後：關閉 QR、清空手輸 UID，回到主掃描介面 */
  const resetScannerAfterSubmit = useCallback(() => {
    stopQrStream();
    setQrOpen(false);
    setSimUid("");
  }, [stopQrStream]);

  const loadTasks = useCallback(async (): Promise<boolean> => {
    if (isManual) {
      setTasks([]);
      return true;
    }

    let filterOrderNo = orderLockNo;
    let filterOrderKey = orderLockKey;

    if (
      !filterOrderNo &&
      !filterOrderKey &&
      taskIdFromQuery &&
      isTaskUuid(taskIdFromQuery)
    ) {
      const probeQ = supabase
        .from("picking_tasks")
        .select("order_no")
        .eq("id", taskIdFromQuery)
        .eq("assigned_operator", sessionName);
      const { data: probe, error: pe } = await probeQ.maybeSingle();
      if (pe) {
        setStatusMsg(pe.message);
        return false;
      }
      if (probe?.order_no != null && String(probe.order_no).trim()) {
        filterOrderNo = String(probe.order_no).trim();
        filterOrderKey = orderGroupKey(probe.order_no);
      } else {
        setTasks([]);
        setStatusMsg("找不到此任務或無權限，請回首頁重選。");
        return true;
      }
    }

    const missingOrderContext =
      !filterOrderKey && !filterOrderNo && !taskIdFromQuery;

    if (missingOrderContext) {
      setTasks([]);
      setStatusMsg(null);
      return true;
    }

    const baseSel =
      "id,order_no,item_no:item_no,item_no,item_name,spec,unit,required_qty:target_qty,picked_qty,is_blind_count,status,assigned_operator,started_at,operation_type";
    const fallbackSel =
      "id,order_no,item_no:item_no,item_no,item_name,unit,required_qty:target_qty,picked_qty,status,assigned_operator,started_at,operation_type";

    const qb = (sel: string, restrictOrderNo: string | null) => {
      let q = supabase
        .from("picking_tasks")
        .select(sel)
        .in("status", ["pending", "in_progress", "completed"])
        .eq("assigned_operator", sessionName)
        .order("created_at", { ascending: false })
        .limit(800);
      if (restrictOrderNo) {
        q = q.eq("order_no", restrictOrderNo);
      }
      return q;
    };

    let { data, error } = await qb(baseSel, filterOrderNo);
    if (
      error?.message.includes("is_blind_count") ||
      error?.message.includes("item_no") ||
      error?.message.includes("unit") ||
      error?.message.includes("spec")
    ) {
      ({ data, error } = await qb(fallbackSel, filterOrderNo));
    }
    if (error) {
      setStatusMsg(error.message);
      return false;
    }

    let rows = (data ?? []) as unknown as Array<
      Omit<PickingTaskRow, "picked_qty"> & {
        item_name?: string | null;
        unit?: string | null;
        spec?: string | null;
        item_no?: string | null;
        picked_qty?: number | null;
        is_blind_count?: boolean | null;
      }
    >;

    if (filterOrderKey) {
      rows = rows.filter(
        (t) => orderGroupKey(t.order_no) === filterOrderKey,
      );
    }

    if (filterOrderNo && rows.length === 0 && filterOrderKey) {
      ({ data, error } = await qb(baseSel, null));
      if (
        error?.message.includes("is_blind_count") ||
        error?.message.includes("item_no") ||
        error?.message.includes("unit") ||
        error?.message.includes("spec")
      ) {
        ({ data, error } = await qb(fallbackSel, null));
      }
      if (error) {
        setStatusMsg(error.message);
        return false;
      }
      rows = (data ?? []) as unknown as typeof rows;
      rows = rows.filter(
        (t) => orderGroupKey(t.order_no) === filterOrderKey,
      );
    }

    const taskIds = rows.map((t) => String(t.id)).filter(Boolean);
    const pickedByTask = new Map<string, number>();
    if (taskIds.length > 0) {
      const lq = supabase
        .from("picking_logs")
        .select("task_id,actual_qty")
        .in("task_id", taskIds);
      const { data: logs, error: lErr } = await lq;
      if (lErr) {
        setStatusMsg(lErr.message);
        return false;
      }
      for (const lg of logs ?? []) {
        const k = String((lg as { task_id?: string | null }).task_id ?? "");
        if (!k) continue;
        const v = Number((lg as { actual_qty?: number | null }).actual_qty) || 0;
        pickedByTask.set(k, (pickedByTask.get(k) ?? 0) + v);
      }
    }

    setTasks(
      rows.map((t) => ({
        ...t,
        item_name: normItemNo(String(t.item_name ?? "")).trim() || undefined,
        unit: normItemNo(String(t.unit ?? "")).trim() || undefined,
        spec: normItemNo(String(t.spec ?? "")).trim() || undefined,
        item_no: normItemNo(String(t.item_no ?? "")).trim(),
        is_blind_count:
          typeof t.is_blind_count === "boolean" ? t.is_blind_count : undefined,
        picked_qty: Math.max(
          Number(t.picked_qty ?? 0) || 0,
          pickedByTask.get(String(t.id)) ?? 0,
        ),
      })),
    );
    return true;
  }, [
    isManual,
    sessionName,
    supabase,
    orderLockKey,
    orderLockNo,
    taskIdFromQuery,
  ]);

  const ensureTasksHydrated = useCallback(async (): Promise<boolean> => {
    if (isManual) return true;
    if (tasksHydrated) return true;
    setHydratingTasks(true);
    try {
      const ok = await loadTasks();
      if (ok) setTasksHydrated(true);
      return ok;
    } finally {
      setHydratingTasks(false);
    }
  }, [isManual, tasksHydrated, loadTasks]);

  const forceReloadTasksFromServer = useCallback(async () => {
    if (isManual) return;
    setHydratingTasks(true);
    try {
      const ok = await loadTasks();
      if (ok) setTasksHydrated(true);
    } finally {
      setHydratingTasks(false);
    }
  }, [isManual, loadTasks]);

  useEffect(() => {
    setTasks([]);
    setTasksHydrated(isManual);
    setSelectedOrderKey("");
    setActiveTask(null);
    setShortPickPromptOpen(false);
    setTaskModalErr(null);
  }, [
    sessionName,
    opType,
    orderLockKey,
    orderLockNo,
    taskIdFromQuery,
    isManual,
  ]);

  const runRetentionCleanup = useCallback(async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const qLog = supabase.from("picking_logs").delete().lt("created_at", cutoff);
    await qLog;
    const qTask = supabase.from("picking_tasks").delete().lt("created_at", cutoff);
    await qTask;
  }, [supabase]);

  useEffect(() => {
    void runRetentionCleanup();
  }, [runRetentionCleanup]);

  const orderChipList = useMemo(() => {
    const bucket = new Map<string, PickingTaskRow[]>();
    for (const t of tasks) {
      const k = orderGroupKey(t.order_no);
      const arr = bucket.get(k) ?? [];
      arr.push(t);
      bucket.set(k, arr);
    }
    return Array.from(bucket.entries())
      .map(([key, ts]) => ({
        key,
        label: normItemNo(ts[0]?.order_no ?? ""),
        ts,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
  }, [tasks]);

  const selectedOrderDisplayLabel = useMemo(() => {
    const chip = orderChipList.find((c) => c.key === selectedOrderKey);
    return chip?.label ?? "";
  }, [orderChipList, selectedOrderKey]);

  /** 資料尚在載入時，先以網址帶入單號顯示於頁首 */
  const headlineOrderLabel = useMemo(
    () =>
      selectedOrderDisplayLabel ||
      (orderLockNo ? normItemNo(orderLockNo) : ""),
    [selectedOrderDisplayLabel, orderLockNo],
  );

  const selectedOrderTasks = useMemo(
    () =>
      tasks.filter((t) => orderGroupKey(t.order_no) === selectedOrderKey),
    [tasks, selectedOrderKey],
  );

  /** 本單作主業務類型文案（藍框標題，不重複單號） */
  const orderMissionHeadline = useMemo(() => {
    const ts = selectedOrderTasks;
    if (!ts.length) return "";
    const modes = new Set(ts.map((t) => rowOperationMode(t)));
    if (modes.size > 1) {
      const seg: string[] = [];
      if (modes.has("inbound")) seg.push("入庫");
      if (modes.has("outbound")) seg.push("檢貨");
      if (modes.has("stocktake")) seg.push("盤點");
      return `${seg.join("／")}作業`;
    }
    const m = rowOperationMode(ts[0]);
    if (m === "outbound") return "檢貨任務";
    if (m === "inbound") return "入庫任務";
    if (m === "stocktake") {
      const blinds = ts.map((t) => Boolean(t.is_blind_count));
      if (blinds.length && blinds.every(Boolean)) {
        return "盤點任務（盲盤模式）";
      }
      if (blinds.length && blinds.every((b) => !b)) {
        return "盤點任務（核對模式）";
      }
      return "盤點任務（含盲盤與核對品項）";
    }
    return "作業任務";
  }, [selectedOrderTasks]);

  const orderProgress = useMemo(() => {
    if (!selectedOrderTasks.length) return null;
    const requiredTotal = selectedOrderTasks.reduce((s, t) => s + t.required_qty, 0);
    const pickedTotal = selectedOrderTasks.reduce((s, t) => s + t.picked_qty, 0);
    const doneLines = selectedOrderTasks.filter(
      (t) => t.picked_qty >= t.required_qty,
    ).length;
    const pct =
      requiredTotal > 0
        ? Math.min(100, Math.round((pickedTotal / requiredTotal) * 100))
        : 0;
    return {
      requiredTotal,
      pickedTotal,
      doneLines,
      lineCount: selectedOrderTasks.length,
      pct,
    };
  }, [selectedOrderTasks]);
  useEffect(() => {
    if (
      isManual ||
      !hasOrderIntent ||
      tasksHydrated ||
      !sessionName ||
      sessionName === "unknown"
    ) {
      return;
    }
    void ensureTasksHydrated();
  }, [
    isManual,
    hasOrderIntent,
    tasksHydrated,
    sessionName,
    ensureTasksHydrated,
  ]);

  useEffect(() => {
    const p = activeTask?.task;
    if (!p || rowOperationMode(p) !== "stocktake") return;
    setConfirmModalQty(!p.is_blind_count ? String(p.required_qty) : "");
  }, [activeTask]);

  useEffect(() => {
    if (isManual) return;
    if (!tasks.length) {
      setSelectedOrderKey("");
      return;
    }
    const derivedKeys = Array.from(
      new Set(tasks.map((t) => orderGroupKey(t.order_no))),
    );
    if (orderLockKey && derivedKeys.includes(orderLockKey)) {
      setSelectedOrderKey(orderLockKey);
      return;
    }
    if (derivedKeys.length === 1) {
      setSelectedOrderKey(derivedKeys[0]);
      return;
    }
    const hit =
      taskIdFromQuery &&
      tasks.find((t) => t.id === taskIdFromQuery);
    if (hit) {
      setSelectedOrderKey(orderGroupKey(hit.order_no));
      return;
    }
    setSelectedOrderKey(derivedKeys[0] ?? "");
  }, [isManual, tasks, orderLockKey, taskIdFromQuery]);

  const insertPickingLogCompat = async (payload: {
    task_id: string;
    order_no: string;
    item_no: string;
    nfc_uid: string;
    actual_qty: number;
    operator: string;
    operator_name: string;
    variance_note: string | null;
  }) => {
    const row: Record<string, unknown> = {
      order_no: String(payload.order_no ?? "").trim() || "UNKNOWN",
      item_no: String(payload.item_no ?? "").trim() || "UNKNOWN",
      actual_qty: Math.min(
        Math.max(0, Math.floor(Number(payload.actual_qty) || 0)),
        2_147_483_647,
      ),
    };
    const nfc = String(payload.nfc_uid ?? "").trim();
    row.nfc_uid = nfc.length ? nfc.slice(0, 500) : null;
    const op = String(payload.operator ?? "").trim();
    row.operator = op.length ? op.slice(0, 200) : null;
    const opn = String(payload.operator_name ?? "").trim();
    row.operator_name = opn.length ? opn.slice(0, 200) : null;
    const vn = payload.variance_note;
    if (vn != null && String(vn).trim() !== "") {
      row.variance_note = String(vn).trim().slice(0, 1000);
    }
    if (isTaskUuid(payload.task_id)) {
      row.task_id = payload.task_id.trim();
    }

    const ins = (r: Record<string, unknown>) =>
      supabase.from("picking_logs").insert(r);

    let { error } = await ins(row);
    let em = error?.message ?? "";

    if (
      error &&
      row.task_id != null &&
      /task_id|uuid|foreign key|invalid.*uuid/i.test(em)
    ) {
      const noTask = { ...row };
      delete noTask.task_id;
      ({ error } = await ins(noTask));
      em = error?.message ?? "";
    }

    if (error && "variance_note" in row && /variance|column/i.test(em)) {
      const noVar = { ...row };
      delete noVar.variance_note;
      ({ error } = await ins(noVar));
      em = error?.message ?? "";
    }

    if (error && "operator_name" in row && /operator_name|column/i.test(em)) {
      const noOpn = { ...row };
      delete noOpn.operator_name;
      ({ error } = await ins(noOpn));
      em = error?.message ?? "";
    }

    if (error) {
      const minimal: Record<string, unknown> = {
        order_no: row.order_no,
        item_no: row.item_no,
        actual_qty: row.actual_qty,
      };
      const { error: e2 } = await ins(minimal);
      return { error: e2 };
    }

    return { error: null };
  };

  const logMismatch = async (
    nfc_uid: string,
    reason: string,
    orderNo?: string,
    itemNo?: string,
  ) => {
    await insertPickingLogCompat({
      task_id: "",
      order_no: orderNo || "MANUAL_SCAN",
      item_no: itemNo || manualItemNo,
      nfc_uid,
      actual_qty: 0,
      operator: sessionName,
      operator_name: sessionName,
      variance_note: `掃錯:${reason}`,
    });
  };

  /** 寫入日誌並更新 picking_tasks 狀態（原 applyQtyForTask） */
  const updateTaskProgress = async (
    task: PickingTaskRow,
    qty: number,
    scanUid: string,
    opts?: { forceCompleteLine?: boolean; ledgerShortageForced?: boolean },
  ): Promise<boolean> => {
    if (!Number.isFinite(qty) || qty <= 0) {
      const m = "請輸入有效的領料數（>0）";
      setStatusMsg(m);
      setTaskModalErr(m);
      return false;
    }
    const mode = rowOperationMode(task);
    const remaining = task.required_qty - task.picked_qty;
    if (mode !== "stocktake" && qty > remaining) {
      const m = `不得超過尚欠數量 ${remaining}`;
      setStatusMsg(m);
      setTaskModalErr(m);
      return false;
    }
    const diff = mode === "stocktake" ? qty - task.required_qty : qty - remaining;
    setVariance(diff);
    const fc =
      (mode === "outbound" || mode === "inbound") &&
      Boolean(opts?.forceCompleteLine);
    const variance_note: string | null =
      mode === "stocktake"
        ? `溢損量:${diff > 0 ? "+" : ""}${diff}`
        : diff === 0
          ? null
          : `損益:${diff > 0 ? "+" : ""}${diff}${fc ? "；人工確認缺量" : ""}`;
    const { error: logErr } = await insertPickingLogCompat({
      task_id: task.id,
      order_no: task.order_no,
      item_no: task.item_no,
      nfc_uid: scanUid,
      actual_qty: qty,
      operator: sessionName,
      operator_name: sessionName,
      variance_note,
    });
    if (logErr) {
      const m = `${logErr.message}（紀錄寫入失敗，請連線後重試）`;
      setStatusMsg(m);
      setTaskModalErr(m);
      return false;
    }
    const pickedAfter = mode === "stocktake" ? qty : task.picked_qty + qty;
    const done = pickedAfter >= task.required_qty;
    const updates: Record<string, unknown> = {
      picked_qty: pickedAfter,
      status: done ? "completed" : "in_progress",
      ended_at: done ? new Date().toISOString() : null,
    };
    if (!task.started_at && task.picked_qty === 0) {
      updates.started_at = new Date().toISOString();
    }
    const upq = supabase.from("picking_tasks").update(updates).eq("id", task.id);
    const { error: upErr } = await upq;
    if (upErr) {
      const m = `${upErr.message}（派單狀態更新失敗）`;
      setStatusMsg(m);
      setTaskModalErr(m);
      return false;
    }
    setMatch("ok");
    vibrate(100);
    playSuccessBeep();
    setStatusMsg(
      mode === "stocktake"
        ? `已更新 ${task.item_no} 盤點數`
        : mode === "inbound"
          ? `已更新 ${task.item_no} 入庫數 ${qty}`
          : `已更新 ${task.item_no} 領料數 ${qty}`,
    );
    const lm = rowOperationMode(task);
    if (lm === "inbound" || lm === "outbound") {
      fireWarehouseLedgerPostMove({
        item_no: normItemNo(task.item_no),
        direction: lm,
        qty: Math.floor(qty),
        shortage_forced: Boolean(opts?.ledgerShortageForced),
        order_no: task.order_no,
        task_id: task.id,
        operator_name: sessionName,
        scan_payload: scanUid,
        seed_item_name:
          typeof task.item_name === "string" ? task.item_name : "",
        seed_spec: typeof task.spec === "string" ? task.spec : "",
      });
    }
    // 不可 await loadTasks：彙總 logs 很慢時會阻塞關閉 Modal，使用者無法接續掃描。
    void loadTasks();
    return true;
  };

  const openTaskConfirmModal = (hit: PickingTaskRow) => {
    setTaskModalErr(null);
    setShortPickPromptOpen(false);
    setMatch("ok");
    vibrate(80);
    playSuccessBeep();

    const mode = rowOperationMode(hit);
    const remaining = Math.max(hit.required_qty - hit.picked_qty, 1);
    if (mode === "stocktake") {
      setConfirmModalQty(hit.is_blind_count ? "" : String(hit.required_qty));
    } else {
      setConfirmModalQty(String(Math.min(1, remaining)));
    }
  };

  /** 將解析出的料號套入當前單據；nfcPayload 為寫入日誌的標籤內容截段（非 UID 清冊） */
  const applyParsedItemNo = async (
    rawScan: string,
    nfcPayload: string,
  ) => {
    const tokens = collectItemCodeCandidates(rawScan);
    const forLog =
      (nfcPayload || "").trim().slice(0, 200) ||
      tokens[0] ||
      "BLANK";

    if (isManual) {
      const first = tokens[0] ?? "";
      setManualItemNo(first || "UNKNOWN");
      setMatch("ok");
      setStatusMsg(`已取得料號：${first || "UNKNOWN"}`);
      vibrate(80);
      playSuccessBeep();
      return;
    }

    let hit: PickingTaskRow | undefined;
    let matchedToken = "";
    for (const token of tokens) {
      const candidates = selectedOrderTasks.filter(
        (t) =>
          itemNoMatchesTask(t.item_no, token) ||
          itemNoMatchesTask(t.item_no ?? "", token),
      );
      const pending = candidates.filter((t) => t.picked_qty < t.required_qty);
      const h = pending[0] ?? candidates[0];
      if (h) {
        hit = h;
        matchedToken = token;
        break;
      }
    }

    if (!hit) {
      setMatch("bad");
      setStatusMsg(
        `料號（${tokens[0] ?? "?"}）不在單號 ${selectedOrderDisplayLabel || selectedOrderKey} 清單內`,
      );
      playErrorBeep();
      vibrate(250);
      speakOperateSuccess("此料號不屬於目前單據");
      await logMismatch(
        forLog,
        "item_no_mismatch",
        selectedOrderDisplayLabel || selectedOrderKey,
        tokens[0] ?? "?",
      );
      return;
    }

    setActiveTask({
      task: hit,
      nfcPayload: forLog,
      matchedItemDisplay: matchedToken || hit.item_no,
    });
    openTaskConfirmModal(hit);
    setStatusMsg(null);
  };

  /** TaskConfirmModal 主確認；forceCompleteLine 僅於「數量不足」二次確認為 true */
  const submitTaskConfirmQty = async (forceCompleteLine: boolean) => {
    if (!activeTask) return;
    const snapshot = activeTask;
    const hit = snapshot.task;
    setTaskModalErr(null);

    const qRaw = confirmModalQty.trim();
    const mode = rowOperationMode(hit);
    const remaining = Math.max(hit.required_qty - hit.picked_qty, 0);

    if (mode === "stocktake" && qRaw === "") {
      setTaskModalErr(
        hit.is_blind_count
          ? "本任務為盲盤，請輸入實盤數後再確認"
          : "請輸入有效數量（須為大於 0 的整數）",
      );
      return;
    }

    const qty = Math.floor(Number(qRaw || "0"));
    if (!Number.isFinite(qty) || qty <= 0) {
      setTaskModalErr("請輸入有效數量（須為大於 0 的整數）");
      return;
    }

    if (mode === "outbound" || mode === "inbound") {
      if (qty > remaining) {
        playErrorBeep();
        vibrate([100, 40, 100, 40, 220]);
        speakOperateSuccess("數量超出");
        setDangerToast(`數量超出：尚可 ${remaining}，請修正後再提交。`);
        return;
      }
      if (qty < remaining && !forceCompleteLine) {
        setShortPickPromptOpen(true);
        return;
      }
    }

    const fc =
      (mode === "outbound" || mode === "inbound") &&
      qty < remaining &&
      forceCompleteLine;

    let ledgerShortageForced = false;

    if (mode === "outbound") {
      try {
        const onHandUrl = new URL(
          "/api/warehouse-ledger/on-hand",
          window.location.origin,
        );
        onHandUrl.searchParams.set("item_no", normItemNo(hit.item_no));
        const r = await fetch(onHandUrl.toString());
        const j = (await r.json()) as {
          found?: boolean;
          on_hand?: number;
          error?: string;
        };
        if (!r.ok) {
          // 與入庫/盤點一致：總帳檢核失敗不阻斷現場作業，改為警示後放行。
          setStatusMsg(
            `總帳檢核暫時不可用，已改為不中斷模式：${j.error || "讀取總帳失敗"}`,
          );
          setTaskModalErr(null);
        } else {
          const found = Boolean(j.found);
          const oh = Number(j.on_hand) || 0;
          if (!found) {
            setStatusMsg("總帳尚無此料號，已改為不中斷模式，請後續補建主檔。");
          } else if (qty > oh) {
            const supervisor =
              sessionRole === "warehouse_admin" ||
              sessionRole === "system_admin";
            const hint = `總帳庫存不足，請檢查資料正確性。\n目前結存：${oh}，本次出庫：${qty}。`;
            if (!supervisor) {
              setDangerToast(null);
              setTaskModalErr(hint);
              playErrorBeep();
              vibrate([100, 50, 100, 50, 240]);
              return;
            }
            if (
              !window.confirm(
                `${hint}\n\n您為倉儲主管身分，仍可強制執行。\n確定繼續？`,
              )
            ) {
              return;
            }
            ledgerShortageForced = true;
          }
        }
      } catch {
        setStatusMsg("無法連線至總帳服務，已改為不中斷模式。");
        setTaskModalErr(null);
      }
    }

    const releaseGen = ++submitConfirmGenRef.current;
    let ok = false;
    try {
      ok = await updateTaskProgress(hit, qty, snapshot.nfcPayload, {
        forceCompleteLine: fc ? true : undefined,
        ledgerShortageForced: ledgerShortageForced ? true : undefined,
      });
    } catch {
      ok = false;
    } finally {
      window.setTimeout(() => {
        if (submitConfirmGenRef.current !== releaseGen) return;
        setActiveTask(null);
        setShortPickPromptOpen(false);
        setTaskModalErr(null);
        setConfirmModalQty("1");
        if (ok) {
          setDangerToast(null);
          try {
            resetScannerAfterSubmit();
            speakOperateSuccess("提交成功");
          } catch {
            void 0;
          }
        } else {
          setDangerToast("寫入失敗，請檢查網路或表單設定");
          try {
            resetScannerAfterSubmit();
          } catch {
            void 0;
          }
        }
      }, POST_SUBMIT_UI_RESET_MS);
    }
  };

  const reportBuckets = useMemo(() => {
    const unscanned = tasks.filter(
      (t) =>
        (t.status === "pending" || t.status === "in_progress") &&
        t.required_qty > 0 &&
        t.picked_qty === 0,
    );
    const withDelta = tasks
      .filter((t) => t.picked_qty > 0 && t.picked_qty !== t.required_qty)
      .map((task) => ({
        task,
        delta: task.picked_qty - task.required_qty,
      }))
      .sort((a, b) =>
        normItemNo(a.task.item_no).localeCompare(
          normItemNo(b.task.item_no),
          "zh-Hant",
        ),
      );
    return { unscanned, withDelta };
  }, [tasks]);

  const handleDecodedScan = async (scanLabelOut: string) => {
    if (!isManual) {
      const ok = await ensureTasksHydrated();
      if (!ok) return;
    }
    if (!selectedOrderKey && !isManual) {
      setStatusMsg("單號尚未就緒，請稍候載入完成；若無法載入請回首頁重選。");
      return;
    }
    const tokens = collectItemCodeCandidates(scanLabelOut);
    if (tokens.length === 0) {
      setMatch("bad");
      playErrorBeep();
      vibrate(260);
      setStatusMsg(`${ITEM_SCAN_FAIL_MSG}\n請重新掃描或確認輸入。`);
      speakOperateSuccess(ITEM_SCAN_FAIL_MSG);
      await logMismatch(
        normItemNo(scanLabelOut).slice(0, 200) || "BLANK",
        "item_no_empty",
        selectedOrderDisplayLabel || selectedOrderKey,
      );
      return;
    }
    const forLog = normItemNo(scanLabelOut).slice(0, 200) || tokens[0];
    await applyParsedItemNo(scanLabelOut, forLog);
  };

  useEffect(() => {
    handleDecodedScanRef.current = handleDecodedScan;
  });

  const startQrScan = async () => {
    setStatusMsg(null);
    if (!isManual) {
      const ok = await ensureTasksHydrated();
      if (!ok) return;
    }
    if (!selectedOrderKey && !isManual) {
      setStatusMsg("單號尚未就緒，請稍候載入完成；若無法載入請回首頁重選。");
      return;
    }
    const BD = typeof window !== "undefined" ? window.BarcodeDetector : undefined;
    if (!BD) {
      setStatusMsg("此瀏覽器不支援相機掃描 QR，請改用手動輸入料號。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      stopQrStream();
      qrStreamRef.current = stream;
      setQrOpen(true);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "無法開啟相機");
    }
  };

  const closeQrScan = () => {
    stopQrStream();
    setQrOpen(false);
  };

  useEffect(() => {
    if (!qrOpen) return;
    const video = qrVideoRef.current;
    const stream = qrStreamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => void 0);
    const Detector = window.BarcodeDetector;
    if (!Detector) {
      stopQrStream();
      setQrOpen(false);
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue?.trim();
          if (raw && alive) {
            alive = false;
            stopQrStream();
            setQrOpen(false);
            await handleDecodedScanRef.current(raw);
            return;
          }
        } catch {
          /* 單幀解碼失敗可忽略 */
        }
      }
      if (alive) requestAnimationFrame(() => void tick());
    };
    const raf = requestAnimationFrame(() => void tick());
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stopQrStream();
    };
  }, [qrOpen, stopQrStream]);

  const openWorkloadReport = async () => {
    if (isManual) return;
    const ok = await ensureTasksHydrated();
    if (!ok) return;
    setReportOpen(true);
  };

  useEffect(() => {
    return () => {
      stopQrStream();
    };
  }, [stopQrStream]);

  const bgClass =
    variance !== null && variance < 0
      ? "bg-red-500"
      : variance !== null && variance > 0
        ? "bg-amber-300"
        : match === "ok"
      ? "bg-emerald-400"
      : match === "bad"
        ? "bg-red-600"
        : "bg-slate-100";

  return (
    <main
      className={`mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-3 p-3 pb-28 sm:p-4 ${bgClass}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-slate-300/60 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
            Operator UI｜現場作業
          </p>
          <p className="truncate text-lg font-black text-slate-900">
            {sessionName}
            <span className="text-sm font-bold text-slate-600">
              {sessionRole === "system_admin"
                ? " · 系統管理"
                : sessionRole === "warehouse_admin"
                  ? " · 倉儲主管"
                  : sessionRole === "unit"
                    ? " · 其他作業區"
                    : " · 倉管員"}
            </span>
          </p>
        </div>
        <Link
          href={appHref("/")}
          prefetch
          className="flex min-h-[48px] shrink-0 flex-col items-end justify-center rounded-xl border-4 border-blue-800 bg-blue-50 px-3 py-1.5 text-right text-sm font-black text-blue-950 shadow-sm active:scale-[0.99]"
        >
          回首頁
          <span className="text-[11px] font-bold text-blue-900">
            選下一單
          </span>
        </Link>
      </header>

      {!isManual && headlineOrderLabel ? (
        <div
          className="rounded-xl border-2 border-emerald-700 bg-emerald-50 px-3 py-2 shadow-sm"
          aria-live="polite"
        >
          <p className="text-center text-[10px] font-black tracking-wide text-emerald-900">
            執行單號
          </p>
          <p className="truncate text-center text-lg font-black leading-tight text-emerald-950 sm:text-xl">
            {headlineOrderLabel}
          </p>
        </div>
      ) : null}

      {dangerToast && (
        <div
          role="alert"
          className="fixed left-4 right-4 top-4 z-[120] mx-auto max-w-lg rounded-xl border-4 border-red-700 bg-red-600 px-4 py-4 text-center text-lg font-black text-white shadow-2xl"
        >
          {dangerToast}
        </div>
      )}

      {statusMsg && (
        <div className="rounded-xl bg-slate-900 p-4 text-xl font-black text-white">
          {statusMsg}
        </div>
      )}

      {!isManual && isOrderContextMissing ? (
        <section className="rounded-2xl border-4 border-amber-600 bg-amber-50 p-6 shadow-lg">
          <h2 className="text-xl font-black text-amber-950">請先選擇今日任務</h2>
          <p className="mt-2 text-base font-semibold leading-relaxed text-amber-900">
            為避免誤掃到其他單據，請從<strong>首頁</strong>選定單號後再進入作業頁。
            完成本作業後請按右上角「回首頁」換下一張單。
          </p>
          <Link
            href={appHref("/")}
            prefetch
            className="mt-5 inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-blue-800 text-xl font-black text-white shadow-lg active:scale-[0.99]"
          >
            回到首頁任務選擇
          </Link>
        </section>
      ) : null}

      {!isManual && !isOrderContextMissing ? (
        <section className="rounded-2xl bg-white p-3 shadow-lg sm:p-4">
          <h2 className="text-base font-black text-slate-800">作業進度</h2>
          {!tasksHydrated ? (
            <div className="mt-3 space-y-3">
              <p className="font-bold text-slate-600">
                尚未載入派單資料。請按下載入（不會一次畫出整張長清單，掃描後再彈窗確認）。
              </p>
              {hydratingTasks && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                  <div className="h-10 w-full animate-pulse rounded bg-slate-200" />
                </div>
              )}
              <button
                type="button"
                disabled={hydratingTasks}
                onClick={() => void ensureTasksHydrated()}
                className="min-h-[52px] w-full rounded-xl bg-blue-700 text-lg font-black text-white disabled:opacity-50"
              >
                {hydratingTasks ? "載入中…" : "載入指派任務"}
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <p className="mt-3 font-black text-slate-500">目前沒有指派給您的待處理派單</p>
          ) : (
            <>
              {orderProgress && selectedOrderKey ? (
                <div className="mt-2 rounded-xl border-2 border-blue-600 bg-blue-50/90 p-3">
                  <div className="text-center text-lg font-black text-slate-900 sm:text-xl">
                    {orderMissionHeadline || "作業任務"}
                  </div>
                  <div
                    className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-200"
                    role="progressbar"
                    aria-valuenow={orderProgress.pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="總數量完成度"
                  >
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(0, orderProgress.pct))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 text-center text-base font-bold text-slate-800">
                    總量 {orderProgress.pickedTotal}／{orderProgress.requiredTotal}（
                    {orderProgress.pct}%）
                  </div>
                  <div className="mt-1 text-center text-sm font-bold text-slate-600">
                    明細行 {orderProgress.doneLines}／{orderProgress.lineCount} 已完成
                  </div>
                </div>
              ) : (
                <p className="mt-3 font-black text-slate-500">
                  尚未取得本單進度資料
                </p>
              )}
              <button
                type="button"
                disabled={hydratingTasks}
                onClick={() => void forceReloadTasksFromServer()}
                className="mt-3 text-sm font-black text-blue-800 underline decoration-2 disabled:opacity-40"
              >
                重新整理任務資料
              </button>
            </>
          )}
        </section>
      ) : null}

      {(selectedOrderKey || isManual) && (
        <>
          <section className="rounded-2xl bg-white p-5 shadow-lg">
            <h2 className="sr-only">料號掃描</h2>
            <button
              type="button"
              className="min-h-[88px] w-full rounded-2xl border-4 border-emerald-700 bg-emerald-600 px-4 text-xl font-black text-white shadow-lg active:scale-[0.99] sm:min-h-[96px] sm:text-2xl"
              onClick={() => void startQrScan()}
            >
              掃描料號 (QR Code)
            </button>
            <div className="mt-6 space-y-3">
              <label
                htmlFor="operate-manual-tag"
                className="block text-base font-black text-slate-900"
              >
                手動輸入料號
              </label>
              <input
                id="operate-manual-tag"
                className="min-h-[56px] w-full rounded-xl border-2 border-slate-400 px-3 text-base font-bold"
                placeholder="請輸入或掃描料號"
                value={simUid}
                onChange={(e) => setSimUid(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleDecodedScan(simUid);
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="min-h-[56px] w-full rounded-xl bg-slate-800 text-lg font-black text-white shadow-md active:scale-[0.99]"
                onClick={() => void handleDecodedScan(simUid)}
              >
                確認送出
              </button>
            </div>
          </section>

          {qrOpen && (
            <div className="fixed inset-0 z-[90] flex flex-col gap-3 bg-black/95 p-4">
              <div className="text-center text-sm font-black text-white">
                將 QR 對準框內；辨識成功後會自動關閉
              </div>
              <video
                ref={qrVideoRef}
                className="max-h-[70vh] w-full flex-1 rounded-xl object-cover"
                playsInline
                muted
              />
              <button
                type="button"
                className="min-h-[52px] w-full rounded-xl bg-white text-lg font-black text-slate-900"
                onClick={() => closeQrScan()}
              >
                關閉相機
              </button>
            </div>
          )}

        </>
      )}

      {activeTask && (
        <TaskConfirmModal
          ctx={activeTask}
          confirmModalQty={confirmModalQty}
          setConfirmModalQty={setConfirmModalQty}
          taskModalErr={taskModalErr}
          shortPickPromptOpen={shortPickPromptOpen}
          onDismissShortPick={() => setShortPickPromptOpen(false)}
          onConfirmShortPick={() => void submitTaskConfirmQty(true)}
          onClose={() => {
            setActiveTask(null);
            setShortPickPromptOpen(false);
            setTaskModalErr(null);
          }}
          onPrimarySubmit={() => void submitTaskConfirmQty(false)}
          clearFieldErr={() => setTaskModalErr(null)}
        />
      )}

      <SummaryModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        buckets={reportBuckets}
      />

      {!isManual && (
        <button
          type="button"
          aria-label="檢視作業清單：漏掃與數量差異"
          className="fixed bottom-6 right-4 z-[100] flex h-[68px] w-[68px] items-center justify-center rounded-full border-4 border-white bg-blue-950 text-[11px] font-black leading-tight text-white shadow-2xl active:scale-95 sm:h-[76px] sm:w-[76px] sm:text-xs"
          onClick={() => void openWorkloadReport()}
        >
          檢視
          <br />
          作業清單
        </button>
      )}

    </main>
  );
}

export default function OperatePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 p-4 pb-28 bg-slate-100">
          <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-52 animate-pulse rounded-2xl bg-slate-200" />
        </main>
      }
    >
      <OperatePageContent />
    </Suspense>
  );
}
