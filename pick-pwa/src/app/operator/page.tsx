"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WarehouseStyleTaskDeck } from "@/components/warehouse/WarehouseStyleTaskDeck";
import {
  clearSessionUser,
  getSessionUser,
  normalizeRole,
} from "@/lib/auth";
import { appHref } from "@/lib/appHref";
import { APP_VERSION } from "@/lib/version";

/**
 * 倉管員登入後工作台：今日派單（picking_tasks）→ 進入 /operate 掃描。
 * 登出回首頁可避免舊 /field「返回」與首頁自動導向造成的循環。
 */
export default function OperatorWorkbenchPage() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  /** 入庫／領料確認（單號＋數量） */
  const [moveModalOpen, setMoveModalOpen] = useState(false);
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
  const scanBusyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({
    code: "",
    at: 0,
  });
  /** Samsung Internet：連續 detect 容易掉幀；節流可提高成功率 */
  const lastDetectAtRef = useRef(0);

  useEffect(() => {
    const u = getSessionUser();
    const role = normalizeRole(u?.role);
    if (!u || role !== "warehouse_staff") {
      router.replace(appHref("/"));
      return;
    }
    setUsername(u.username);
  }, [router]);

  const exitToLogin = () => {
    clearSessionUser();
    router.replace(appHref("/"));
  };

  useEffect(() => {
    scanBusyRef.current = scanBusy;
  }, [scanBusy]);

  /** 僅停止解碼迴圈，保留相機預覽（辨識成功後與圖一一致：仍可看到鏡頭畫面） */
  const stopDecodeLoopOnly = () => {
    scanningActiveRef.current = false;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopScanner = () => {
    stopDecodeLoopOnly();
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
      url.searchParams.set("qr", qr);
      const r = await fetch(url.toString());
      const j = (await r.json()) as {
        found?: boolean;
        message?: string;
        error?: string;
        inventory?: {
          item_name?: string;
          spec?: string;
          on_hand?: number;
        };
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
      if (!r.ok) {
        const raw = j.error ?? "";
        if (/Database Connection Error/i.test(raw)) {
          throw new Error("Database Connection Error");
        }
        throw new Error(
          /42703|does not exist/i.test(raw)
            ? "查無此料號，請檢查資料庫設定"
            : raw || "辨識失敗",
        );
      }
      if (!j.found || !j.record?.id || !j.record?.item_no) {
        setDetail(null);
        setScanMsg(
          j.message ?? "查無此料號，請檢查資料庫設定",
        );
        return;
      }

      const inv = j.inventory;
      const meta = j.record.meta ?? {};
      const nameFromLedger = String(inv?.item_name ?? "").trim();
      const specFromLedger = String(inv?.spec ?? "").trim();
      const nameFromMeta = String(
        (meta as { item_name?: string }).item_name ?? "",
      ).trim();
      const specFromMeta = String(
        (meta as { spec?: string }).spec ?? "",
      ).trim();

      setDetail({
        label_record_id: String(j.record.id),
        qr_payload: String(j.record.qr_payload ?? qr),
        item_no: String(j.record.item_no),
        item_name: nameFromLedger || nameFromMeta || undefined,
        spec: specFromLedger || specFromMeta || undefined,
        on_hand: Number(inv?.on_hand ?? 0) || 0,
      });
      setSelectedAction(null);
      setOrderNo("");
      setQty("1");
      setMoveModalOpen(false);
      stopDecodeLoopOnly();
      setScanMsg("辨識成功，請選擇入庫或領料。");
    } catch (e) {
      setDetail(null);
      const m = e instanceof Error ? e.message : "辨識失敗";
      setScanMsg(
        m === "Database Connection Error"
          ? "資料庫連線失敗（Database Connection Error）。請確認 SUPABASE_SERVICE_ROLE_KEY 與 Supabase 專案設定。"
          : /42703|does not exist|failed/i.test(m)
            ? "查無此料號，請檢查資料庫設定"
            : m,
      );
    } finally {
      setScanBusy(false);
    }
  };

  /** 在相機已啟動的前提下開始／恢復解碼迴圈（辨識成功後按「重新掃描」會用到） */
  const kickDecodeLoop = () => {
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
      if (scanBusyRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
        return;
      }
      const v = videoRef.current;
      if (v.videoWidth === 0 || v.videoHeight === 0) {
        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
        return;
      }
      const t = performance.now();
      if (t - lastDetectAtRef.current < 160) {
        rafRef.current = requestAnimationFrame(() => {
          void loop();
        });
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
            rafRef.current = requestAnimationFrame(() => {
              void loop();
            });
            return;
          }
          lastScanRef.current = { code, at: now };
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
  };

  const submitMove = async () => {
    const action = selectedAction;
    if (!action) {
      setScanMsg("請先選擇領料或入庫");
      return;
    }
    if (!username || !detail) {
      setScanMsg("請先完成辨識");
      return;
    }
    if (!orderNo.trim()) {
      setScanMsg("請輸入單號");
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
          : "入庫成功，已更新庫存與交易紀錄。",
      );
      setMoveModalOpen(false);
      setDetail(null);
      setSelectedAction(null);
      setScanManualInput("");
      setOrderNo("");
      setQty("1");
      stopScanner();
      setScanOpen(false);
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
    setDetail(null);
    setMoveModalOpen(false);
    setSelectedAction(null);
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
      kickDecodeLoop();
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
            onClick={() => router.push(appHref("/operator/transactions"))}
            className="h-28 rounded-2xl border-2 border-slate-300 bg-white px-4 text-xl font-black text-slate-800 shadow-sm"
          >
            查看領退紀錄
          </button>
        </div>
        {scanMsg && !scanOpen && !moveModalOpen ? (
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
              autoPlay
            />
            {/* 瞄準框：辨識成功後保留預覽，改為提示下方操作 */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4">
              {!detail ? (
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
              ) : (
                <p className="mt-4 text-center text-base font-black text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                  已辨識 · 請於下方選擇入庫或領料
                </p>
              )}
            </div>
          </div>
          <div className="shrink-0 space-y-2 rounded-t-2xl bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
            {!detail ? (
              <>
                {scanMsg ? (
                  <p className="rounded-lg bg-amber-50 px-2 py-2 text-center text-xs font-bold text-amber-950">
                    {scanMsg}
                  </p>
                ) : null}
                <p className="text-center text-[11px] font-bold text-slate-500">
                  相機將自動辨識；手動請貼上後按 Enter（與掃描同一支 API）。
                </p>
                <input
                  className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-900"
                  placeholder="手動貼上 QR / 料號"
                  value={scanManualInput}
                  onChange={(e) => setScanManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runLookup(scanManualInput);
                  }}
                />
                <button
                  type="button"
                  disabled={scanBusy}
                  className="h-11 w-full rounded-xl bg-blue-800 text-sm font-black text-white disabled:opacity-50"
                  onClick={() => void runLookup(scanManualInput)}
                >
                  {scanBusy ? "辨識中…" : "確認辨識"}
                </button>
              </>
            ) : (
              <div className="space-y-3 rounded-xl bg-zinc-800 p-4 text-white shadow-inner">
                <p className="text-base font-black leading-relaxed">
                  <span className="text-zinc-400">料號</span>{" "}
                  <span className="text-white">{detail.item_no}</span>
                </p>
                <p className="text-base font-black leading-relaxed">
                  <span className="text-zinc-400">品名</span>{" "}
                  <span className="text-white">{detail.item_name || "—"}</span>
                </p>
                <p className="text-base font-black leading-relaxed">
                  <span className="text-zinc-400">規格</span>{" "}
                  <span className="text-white">{detail.spec || "—"}</span>
                </p>
                <p className="text-sm font-bold text-zinc-300">
                  帳上庫存：{Number(detail.on_hand ?? 0)}
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    className="flex min-h-[52px] flex-col items-center justify-center rounded-xl bg-zinc-500 text-sm font-black text-white active:scale-[0.99]"
                    onClick={() => {
                      setDetail(null);
                      setMoveModalOpen(false);
                      setSelectedAction(null);
                      setScanMsg(null);
                      lastScanRef.current = { code: "", at: 0 };
                      if (streamRef.current && videoRef.current?.srcObject) {
                        scanningActiveRef.current = true;
                        kickDecodeLoop();
                      } else {
                        void startQrScan();
                      }
                    }}
                  >
                    <span className="text-lg" aria-hidden>
                      ↺
                    </span>
                    重新掃描
                  </button>
                  <button
                    type="button"
                    className="flex min-h-[52px] flex-col items-center justify-center rounded-xl bg-emerald-600 text-sm font-black text-white active:scale-[0.99]"
                    onClick={() => {
                      setScanMsg(null);
                      setSelectedAction("return");
                      setMoveModalOpen(true);
                    }}
                  >
                    <span className="text-lg" aria-hidden>
                      📥
                    </span>
                    入庫
                  </button>
                  <button
                    type="button"
                    className="flex min-h-[52px] flex-col items-center justify-center rounded-xl bg-blue-700 text-sm font-black text-white active:scale-[0.99]"
                    onClick={() => {
                      setScanMsg(null);
                      setSelectedAction("pick");
                      setMoveModalOpen(true);
                    }}
                  >
                    <span className="text-lg" aria-hidden>
                      📤
                    </span>
                    領料
                  </button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setScanOpen(false);
                setMoveModalOpen(false);
                stopScanner();
                setDetail(null);
              }}
              className="h-11 w-full rounded-xl bg-slate-800 text-sm font-black text-white"
            >
              關閉
            </button>
          </div>
        </section>
      ) : null}

      {moveModalOpen && detail ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border-4 border-blue-900 bg-white p-5 shadow-xl"
          >
            <h3 className="text-xl font-black text-slate-900">
              {selectedAction === "pick" ? "📦 領料數量" : "📥 入庫數量"}
            </h3>
            <p className="mt-2 text-sm font-bold text-slate-600">
              {detail.item_no} · {detail.item_name || "—"}{" "}
              {detail.spec ? `（${detail.spec}）` : ""}
            </p>
            <label className="mt-4 block text-sm font-black text-slate-800">
              單號（必填）
              <input
                className="mt-1 h-12 w-full rounded-xl border-2 border-slate-400 px-3 text-base font-bold"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="例：PO-2025-001"
              />
            </label>
            <label className="mt-3 block text-sm font-black text-slate-800">
              數量
              <input
                className="mt-1 h-12 w-full rounded-xl border-2 border-slate-400 px-3 text-base font-bold"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="numeric"
              />
            </label>
            {scanMsg ? (
              <p className="mt-3 text-center text-sm font-black text-red-700">
                {scanMsg}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="min-h-[52px] flex-1 rounded-xl bg-slate-300 text-lg font-black text-slate-900"
                onClick={() => {
                  setMoveModalOpen(false);
                  setSelectedAction(null);
                  setScanMsg(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={moveBusy || !orderNo.trim()}
                className="min-h-[52px] flex-1 rounded-xl bg-blue-800 text-lg font-black text-white disabled:opacity-50"
                onClick={() => void submitMove()}
              >
                {moveBusy ? "送出中…" : "確認送出"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <WarehouseStyleTaskDeck assignedOperator={username} />
    </main>
  );
}
