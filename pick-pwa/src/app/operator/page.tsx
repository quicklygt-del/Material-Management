"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WarehouseStyleTaskDeck } from "@/components/warehouse/WarehouseStyleTaskDeck";
import {
  clearSessionUser,
  getSessionUser,
  normalizeRole,
} from "@/lib/auth";
import { getDefaultLabelPrefix } from "@/lib/labelEncoding";
import { withTenantParam } from "@/lib/tenantNav";
import { APP_VERSION } from "@/lib/version";

/**
 * 倉管員登入後工作台：今日派單（picking_tasks）→ 進入 /operate 掃描。
 * 登出回首頁可避免舊 /field「返回」與首頁自動導向造成的循環。
 */
export default function OperatorWorkbenchPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<"pick" | "return" | null>(null);
  const [orderNo, setOrderNo] = useState("");
  const [qty, setQty] = useState("1");
  const [moveBusy, setMoveBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanManualInput, setScanManualInput] = useState("");
  const [detail, setDetail] = useState<{
    label_record_id: string;
    qr_payload: string;
    item_no: string;
    item_name?: string;
    spec?: string;
    on_hand?: number;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  /** 掃描迴圈必須用 ref：避免 `scanOpen` 閉包仍為 false 導致無法辨識 */
  const scanningActiveRef = useRef(false);

  useEffect(() => {
    const u = getSessionUser();
    const role = normalizeRole(u?.role);
    if (!u || role !== "warehouse_staff") {
      router.replace(withTenantParam("/"));
      return;
    }
    setUsername(u.username);
  }, [router]);

  const exitToLogin = () => {
    clearSessionUser();
    router.replace(withTenantParam("/"));
  };

  const tenantId = getDefaultLabelPrefix();

  const stopScanner = () => {
    scanningActiveRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const tr of streamRef.current.getTracks()) tr.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const runLookup = async (rawInput: string) => {
    const qr = rawInput.trim();
    if (!qr) {
      setScanMsg("請先輸入或掃描 QR / 料號");
      return;
    }
    setScanBusy(true);
    setScanMsg(null);
    try {
      const url = new URL("/api/label-records/lookup", window.location.origin);
      url.searchParams.set("tenant", tenantId);
      url.searchParams.set("qr", qr);
      const r = await fetch(url.toString());
      const j = (await r.json()) as {
        found?: boolean;
        error?: string;
        record?: {
          id?: string;
          qr_payload?: string;
          item_no?: string;
          meta?: {
            item_name?: string;
            spec?: string;
          };
        };
      };
      if (!r.ok) throw new Error(j.error || "辨識失敗");
      if (!j.found || !j.record?.id || !j.record?.item_no) {
        setDetail(null);
        setScanMsg("找不到對應標籤，請確認 QR 是否正確。");
        return;
      }

      const balanceUrl = new URL("/api/warehouse-ledger/on-hand", window.location.origin);
      balanceUrl.searchParams.set("item_no", String(j.record.item_no));
      const balResp = await fetch(balanceUrl.toString());
      const balJson = (await balResp.json().catch(() => ({}))) as {
        on_hand?: number;
      };

      setDetail({
        label_record_id: String(j.record.id),
        qr_payload: String(j.record.qr_payload ?? qr),
        item_no: String(j.record.item_no),
        item_name: String(j.record.meta?.item_name ?? "").trim() || undefined,
        spec: String(j.record.meta?.spec ?? "").trim() || undefined,
        on_hand: Number(balJson.on_hand ?? 0) || 0,
      });
      setSelectedAction(null);
      setOrderNo("");
      setQty("1");
      setDetailOpen(true);
      setScanOpen(false);
      stopScanner();
      setScanMsg("辨識成功，可執行領料或退料。");
    } catch (e) {
      setDetail(null);
      setScanMsg(e instanceof Error ? e.message : "辨識失敗");
    } finally {
      setScanBusy(false);
    }
  };

  const submitMove = async () => {
    const action = selectedAction;
    if (!action) {
      setScanMsg("請先選擇領料作業或退料作業");
      return;
    }
    if (!username || !detail) {
      setScanMsg("請先完成辨識");
      return;
    }
    const quantity = Math.floor(Number(qty || "0"));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setScanMsg("數量需為大於 0 的整數");
      return;
    }
    setMoveBusy(true);
    setScanMsg(null);
    try {
      const r = await fetch("/api/inventory/quick-move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          action,
          operator_name: username,
          order_no: orderNo.trim(),
          item_no: detail.item_no,
          label_record_id: detail.label_record_id,
          qr_payload: detail.qr_payload,
          quantity,
        }),
      });
      const j = (await r.json()) as { error?: string; on_hand?: number };
      if (!r.ok) throw new Error(j.error || "庫存異動失敗");
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              on_hand: Number(j.on_hand ?? prev.on_hand ?? 0) || 0,
            }
          : prev,
      );
      setScanMsg(
        action === "pick"
          ? "領料成功，已更新庫存與交易紀錄。"
          : "退料成功，已更新庫存與交易紀錄。",
      );
      setSelectedAction(null);
      setOrderNo("");
      setQty("1");
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "庫存異動失敗");
    } finally {
      setMoveBusy(false);
    }
  };

  const startQrScan = async () => {
    if (scanBusy) return;
    setScanMsg(null);
    setScanManualInput("");
    scanningActiveRef.current = true;
    setScanOpen(true);
    const Detector =
      typeof window !== "undefined" ? window.BarcodeDetector : undefined;
    if (!Detector) {
      scanningActiveRef.current = false;
      setScanMsg("此瀏覽器不支援相機掃描，請改用手動貼上 QR。");
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
          const v = videoRef.current;
          if (!v) {
            resolve();
            return;
          }
          if (v.readyState >= 2) resolve();
          else v.addEventListener("loadeddata", () => resolve(), { once: true });
        });
      }
      const det = new Detector({
        formats: ["qr_code", "code_128", "code_39", "ean_13", "upc_a"],
      });
      const loop = async () => {
        if (!videoRef.current || !scanningActiveRef.current) return;
        const v = videoRef.current;
        if (v.videoWidth === 0 || v.videoHeight === 0) {
          rafRef.current = requestAnimationFrame(() => {
            void loop();
          });
          return;
        }
        try {
          const found = await det.detect(videoRef.current);
          const code = String(found?.[0]?.rawValue ?? "").trim();
          if (code) {
            await runLookup(code);
            return;
          }
        } catch {
          void 0;
        }
        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
      };
      void loop();
    } catch {
      scanningActiveRef.current = false;
      setScanMsg("無法啟用相機，請檢查權限或改用手動貼上 QR。");
    }
  };

  useEffect(() => {
    if (!scanOpen) stopScanner();
    return () => {
      stopScanner();
    };
  }, [scanOpen]);

  if (!username) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-white text-sm font-black text-slate-600">
        驗證身分中…
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col gap-4 bg-[#F8FAFC] px-4 pb-10 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <header className="border-b border-slate-200 bg-white/90 pb-3 pt-1 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={exitToLogin}
            className="min-h-[44px] rounded-xl px-2 text-xl font-black text-slate-700 hover:bg-slate-100"
            aria-label="登出並回首頁"
          >
            ←
          </button>
          <div className="flex-1 min-w-0 text-center">
            <p className="truncate text-lg font-black text-slate-900">{username}</p>
            <h1 className="text-sm font-black text-slate-700">倉管員工作台</h1>
            <p className="text-[10px] font-bold text-blue-700">{APP_VERSION}</p>
          </div>
          <div className="w-10 shrink-0" aria-hidden />
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void startQrScan()}
            className="flex h-28 flex-col items-center justify-center rounded-2xl border-4 border-violet-800 bg-violet-600 text-white shadow-md"
          >
            <span className="text-4xl">⌁</span>
            <span className="mt-1 text-2xl font-black">點我掃描</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(withTenantParam("/operator/transactions"))}
            className="h-28 rounded-2xl border-2 border-slate-300 bg-white px-4 text-xl font-black text-slate-800 shadow-sm"
          >
            查看領退紀錄
          </button>
        </div>
        {scanMsg ? (
          <p className="mt-3 text-sm font-bold text-slate-700">{scanMsg}</p>
        ) : null}
      </section>

      {scanOpen ? (
        <section className="fixed inset-0 z-[90] flex flex-col bg-black">
          <div className="relative min-h-0 flex-1">
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full bg-black object-cover"
              playsInline
              muted
            />
            {/* 瞄準框：pointer-events-none 不阻擋相機管線，僅視覺疊加 */}
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
            <input
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
              placeholder="手動貼上 QR / 料號"
              value={scanManualInput}
              onChange={(e) => setScanManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runLookup(scanManualInput);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void runLookup(scanManualInput)}
                disabled={scanBusy}
                className="h-11 rounded-xl bg-blue-700 text-sm font-black text-white disabled:opacity-50"
              >
                {scanBusy ? "辨識中..." : "辨識"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setScanOpen(false);
                  stopScanner();
                }}
                className="h-11 rounded-xl bg-slate-800 text-sm font-black text-white"
              >
                關閉
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {detailOpen && detail ? (
        <section className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border-4 border-slate-900 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-slate-900">物料辨識結果</h2>
              <button
                type="button"
                onClick={() => {
                  setDetailOpen(false);
                  setSelectedAction(null);
                }}
                className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-black text-white"
              >
                關閉
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-800">
              <p>料號：{detail.item_no}</p>
              <p>
                品名：{detail.item_name || "-"}
                {detail.spec ? ` (${detail.spec})` : ""}
              </p>
              <p>目前庫存：{Number(detail.on_hand ?? 0)}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedAction("pick")}
                className={`h-12 rounded-xl text-base font-black text-white ${
                  selectedAction === "pick" ? "bg-blue-900" : "bg-blue-700"
                }`}
              >
                領料作業
              </button>
              <button
                type="button"
                onClick={() => setSelectedAction("return")}
                className={`h-12 rounded-xl text-base font-black text-white ${
                  selectedAction === "return" ? "bg-emerald-900" : "bg-emerald-700"
                }`}
              >
                退料作業
              </button>
            </div>

            {selectedAction ? (
              <div className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3">
                <input
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
                  placeholder="單號（選填）"
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                />
                <input
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
                  placeholder="數量"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="numeric"
                />
                <button
                  type="button"
                  onClick={() => void submitMove()}
                  disabled={moveBusy}
                  className="h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white disabled:opacity-50"
                >
                  {moveBusy
                    ? "送出中..."
                    : selectedAction === "pick"
                      ? "確認領料"
                      : "確認退料"}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <WarehouseStyleTaskDeck assignedOperator={username} />
    </main>
  );
}
