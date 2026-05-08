"use client";

import Link from "next/link";
import { ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { parseLabelQrPayload } from "@/lib/labelEncoding";
import { withTenantParam } from "@/lib/tenantNav";

type LookupRecord = {
  id?: string;
  label_type: string;
  item_no: string;
  qr_payload: string;
  meta: Record<string, unknown> | null;
  manageable_asset?: boolean | null;
};

type UnitCtx = {
  unit_id: string;
  slug: string;
  name: string;
  : string;
  portal_login: string;
};

type UniTxKind = "inbound" | "pick" | "stocktake";

/** 紅綠燈式：入庫綠／出庫紅／盤點黃，選中時加粗邊框與光暈 */
const SCAN_SEG: Record<
  UniTxKind,
  { chip: string; active: string; idle: string }
> = {
  inbound: {
    chip: "入庫",
    active:
      "border-[5px] border-white bg-green-600 text-white shadow-[0_0_24px_rgba(34,197,94,0.95)] ring-4 ring-green-400 scale-[1.02]",
    idle: "border-2 border-zinc-700 bg-zinc-900/90 text-green-400/70",
  },
  pick: {
    chip: "出庫",
    active:
      "border-[5px] border-white bg-red-600 text-white shadow-[0_0_24px_rgba(239,68,68,0.95)] ring-4 ring-red-400 scale-[1.02]",
    idle: "border-2 border-zinc-700 bg-zinc-900/90 text-red-400/70",
  },
  stocktake: {
    chip: "盤點",
    active:
      "border-[5px] border-white bg-amber-500 text-black shadow-[0_0_24px_rgba(245,158,11,0.95)] ring-4 ring-amber-300 scale-[1.02]",
    idle: "border-2 border-zinc-700 bg-zinc-900/90 text-amber-400/70",
  },
};

const COOLDOWN_MS = 2500;
const SUCCESS_TOAST_MS = 2800;

function successVibrate() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([200, 100, 200, 100, 280]);
    }
  } catch {
    void 0;
  }
}

function successBeep() {
  try {
    const ACtx =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext
        : undefined;
    if (!ACtx) return;
    const ctx = new ACtx();
    void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(g);
    g.connect(ctx.destination);
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    osc.start(t0);
    osc.stop(t0 + 0.36);
  } catch {
    void 0;
  }
}

function isManageable(record: LookupRecord): boolean {
  if (record.manageable_asset === false) return false;
  const m = record.meta;
  if (m && m.manageable_asset === false) return false;
  return record.label_type !== "Q";
}

function isUniversalLabelType(t: string): boolean {
  return t === "D" || t === "UNIVERSAL";
}

function displayName(rec: LookupRecord | null): string {
  if (!rec) return "";
  const meta = rec.meta ?? {};
  const n = String(
    (meta as { product_name?: unknown }).product_name ??
      (meta as { description?: unknown }).description ??
      "",
  ).trim();
  return n || String(rec.item_no ?? "").trim();
}

function lineSummary(record: LookupRecord): string {
  const m = record.meta ?? {};
  const u = String(
    (m as { user_content?: unknown }).user_content ??
      (m as { description?: unknown }).description ??
      (m as { project_name?: unknown }).project_name ??
      "",
  ).trim();
  return u || String(record.qr_payload ?? "").trim();
}

export function UnitDedicatedWorkspace({ slug }: { slug: string }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<UnitCtx | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);

  const [produceAction, setProduceAction] = useState<UniTxKind>("pick");
  const [produceQty, setProduceQty] = useState(1);
  const [produceOnHand, setProduceOnHand] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [scanCenterOpen, setScanCenterOpen] = useState(false);
  const [qrPaste, setQrPaste] = useState("");
  const [busyLook, setBusyLook] = useState(false);
  const [errLook, setErrLook] = useState<string | null>(null);
  const [invEcho, setInvEcho] = useState<string | null>(null);
  const [scanSuccessToast, setScanSuccessToast] = useState<string | null>(
    null,
  );

  const scanThrottleUntilRef = useRef(0);
  const qrInFlightRef = useRef(false);

  const [canScan, setCanScan] = useState(false);

  useEffect(() => {
    setCanScan(typeof window !== "undefined" && "BarcodeDetector" in window);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as Partial<UnitCtx> & {
        error?: string;
      };
      if (!alive) return;
      if (!res.ok) {
        setCtxErr(j.error ?? "無法載入身分");
        return;
      }
      const canonSlug = String(j.slug ?? "").trim();
      setCtx({
        unit_id: String(j.unit_id ?? ""),
        slug: canonSlug,
        name: String(j.name ?? ""),
        : String(j. ?? ""),
        portal_login: String(j.portal_login ?? "").trim(),
      });
      if (canonSlug && canonSlug !== slug) {
        router.replace(`/unit/${encodeURIComponent(canonSlug)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, router]);

  const logout = async () => {
    await fetch("/api/unit-portal/logout", {
      method: "POST",
      credentials: "include",
    });
    router.replace(withTenantParam("/"));
  };

  const fireSuccessToast = useCallback((line: string) => {
    setScanSuccessToast(`✅ 已入帳\n${line}`);
    successVibrate();
    successBeep();
    window.setTimeout(() => setScanSuccessToast(null), SUCCESS_TOAST_MS);
    scanThrottleUntilRef.current = Date.now() + COOLDOWN_MS;
  }, []);

  const postUniversalLedgerTx = useCallback(
    async (rec: LookupRecord, kind: UniTxKind): Promise<boolean> => {
      if (!ctx) return false;
      setInvEcho(null);
      if (!rec.id) return false;
      if (kind !== "stocktake") {
        if (!Number.isFinite(produceQty) || produceQty <= 0) {
          setInvEcho("數量無效");
          return false;
        }
      } else if (!Number.isFinite(produceOnHand)) {
        setInvEcho("請填盤點現存數（整數）");
        return false;
      }
      const qv =
        kind === "stocktake"
          ? Math.trunc(produceOnHand)
          : Math.trunc(produceQty);
      try {
        const sumPrefix =
          kind === "inbound"
            ? "【📥 入庫】"
            : kind === "pick"
              ? "【📤 出庫】"
              : "【🔍 盤點】";
        const summaryPayload =
          `${sumPrefix} ${lineSummary(rec)}`.trim().slice(0, 2000);

        const res = await fetch("/api/universal-ledger/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            : ctx.,
            unit_id: ctx.unit_id,
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
        return true;
      } catch (e) {
        setInvEcho(e instanceof Error ? e.message : "失敗");
        return false;
      }
    },
    [ctx, produceOnHand, produceQty],
  );

  const fetchRecord = useCallback(
    async (rawIn: string) => {
      if (!ctx) return;
      if (Date.now() < scanThrottleUntilRef.current) return;
      if (qrInFlightRef.current) return;

      const raw = rawIn.replace(/\uFEFF/g, "").trim();
      setErrLook(null);
      setInvEcho(null);
      if (!raw) return;

      qrInFlightRef.current = true;
      setBusyLook(true);
      try {
        const u = new URL("/api/label-records/lookup", window.location.origin);
        u.searchParams.set("tenant", ctx.);
        u.searchParams.set("qr", raw);
        const res = await fetch(u.toString());
        const json = (await res.json()) as {
          found?: boolean;
          record?: LookupRecord;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "錯誤");
        const fc = Boolean(json.found);
        const rec = json.record ?? null;

        if (!fc || !rec || !isManageable(rec)) {
          setErrLook(fc ? "無法操作此標籤" : "查無紀錄");
          return;
        }
        if (!isUniversalLabelType(rec.label_type)) {
          setErrLook("此碼非單位萬用標籤");
          return;
        }

        const posted =
          displayName(rec) ||
          String(rec.item_no ?? "").trim() ||
          lineSummary(rec).slice(0, 48);
        const ok = await postUniversalLedgerTx(rec, produceAction);
        if (ok) {
          fireSuccessToast(posted);
        }
      } catch (e) {
        setErrLook(e instanceof Error ? e.message : "錯誤");
      } finally {
        setBusyLook(false);
        qrInFlightRef.current = false;
      }
    },
    [ctx, fireSuccessToast, postUniversalLedgerTx, produceAction],
  );

  useEffect(() => {
    if (!scanCenterOpen || !canScan || typeof window === "undefined") return;

    const Detector = window.BarcodeDetector;
    if (!Detector) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    const tick = async () => {
      const el = videoRef.current;
      if (stopped || !el) return;
      if (Date.now() < scanThrottleUntilRef.current || qrInFlightRef.current) {
        raf = requestAnimationFrame(() => void tick());
        return;
      }
      try {
        const codes = await detector.detect(el);
        const val = codes[0]?.rawValue?.trim();
        if (val) {
          void fetchRecord(val);
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
  }, [canScan, scanCenterOpen, fetchRecord]);

  const serialLinePreview = useMemo(() => {
    if (!qrPaste) return "";
    const p = parseLabelQrPayload(qrPaste);
    return p?.serial ? `${p.prefix}-${p.typeCode}-${p.serial}` : qrPaste;
  }, [qrPaste]);

  if (ctxErr) {
    return (
      <div className="px-4 py-16 text-center text-sm font-black text-red-700">
        {ctxErr}
        <button
          type="button"
          onClick={() => router.replace(withTenantParam("/other-operations"))}
          className="mx-auto mt-6 block rounded-xl bg-slate-900 px-6 py-3 text-white"
        >
          重新登入
        </button>
      </div>
    );
  }

  if (!ctx) {
    return (
      <p className="py-24 text-center text-2xl font-black text-zinc-600">
        載入中…
      </p>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-white font-sans text-zinc-900">
      <header className="sticky top-0 z-20 shrink-0 bg-white px-4 py-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h1 className="text-center text-2xl font-black text-zinc-900">
          【{ctx.name}】
        </h1>
        <button
          type="button"
          onClick={() => void logout()}
          className="absolute right-4 top-[max(0.75rem,env(safe-area-inset-top))] min-h-[3rem] min-w-[3.5rem] rounded-xl bg-zinc-200 px-3 text-lg font-black text-zinc-900"
        >
          登出
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-14 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
        <div className="flex shrink-0 flex-col items-center gap-4">
          <button
            type="button"
            title="掃描中心"
            disabled={busyLook || !ctx}
            onClick={() => {
              setErrLook(null);
              setInvEcho(null);
              setScanCenterOpen(true);
            }}
            className="flex h-[7.125rem] w-[7.125rem] shrink-0 items-center justify-center rounded-[1.35rem] border-[6px] border-violet-800 bg-violet-600 text-white shadow-2xl active:scale-[0.98] disabled:opacity-40"
          >
            <ScanLine
              className="text-white"
              size={63}
              strokeWidth={2.75}
              aria-hidden
            />
          </button>
          <span className="text-center text-[26px] font-black leading-tight text-zinc-900">
            點我掃描
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <Link
            href={`/unit/${encodeURIComponent(ctx.slug)}/label-print`}
            className="flex min-h-[5.75rem] w-full max-w-md items-center justify-center rounded-2xl border-[5px] border-indigo-950 bg-indigo-700 px-6 py-5 text-center text-[26px] font-black leading-snug text-white shadow-xl active:scale-[0.99]"
          >
            QR 標籤產製與列印
          </Link>
        </div>

        <Link
          href={`/unit/${encodeURIComponent(ctx.slug)}/ledger-preview`}
          className="mt-auto flex min-h-[5.75rem] w-full shrink-0 items-center justify-center rounded-2xl border-[5px] border-emerald-950 bg-emerald-700 px-6 py-5 text-center text-[26px] font-black leading-snug text-white shadow-xl active:scale-[0.99]"
        >
          預覽與下載本單位總帳
        </Link>
      </main>

      {scanCenterOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-label="掃描中心"
          className="fixed inset-0 z-[100] flex flex-col bg-zinc-950 text-white"
        >
          {scanSuccessToast ? (
            <div className="pointer-events-none fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-6">
              <div className="max-w-[min(92vw,26rem)] whitespace-pre-line rounded-[2rem] border-[6px] border-white bg-emerald-600 px-8 py-12 text-center text-[26px] font-black leading-snug text-white shadow-[0_0_48px_rgba(16,185,129,0.6)]">
                {scanSuccessToast}
              </div>
            </div>
          ) : null}

          <div className="flex shrink-0 flex-col gap-4 px-4 pb-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => setScanCenterOpen(false)}
              className="self-start rounded-2xl bg-white px-6 py-4 text-xl font-black text-zinc-900 shadow-lg active:scale-[0.98]"
            >
              關閉掃描
            </button>
            <div className="grid grid-cols-3 gap-3">
              {(["inbound", "pick", "stocktake"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={busyLook}
                  onClick={() => setProduceAction(k)}
                  className={`min-h-[5.25rem] rounded-2xl py-2 text-center text-[22px] font-black transition-transform ${
                    produceAction === k ? SCAN_SEG[k].active : SCAN_SEG[k].idle
                  }`}
                >
                  {SCAN_SEG[k].chip}
                </button>
              ))}
            </div>
            <div>
              {produceAction !== "stocktake" ? (
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="w-full rounded-2xl border-4 border-white/35 bg-black/50 py-5 text-center text-3xl font-black text-white"
                  value={produceQty}
                  onChange={(e) => setProduceQty(Number(e.target.value))}
                  disabled={busyLook}
                />
              ) : (
                <input
                  type="number"
                  inputMode="numeric"
                  className="w-full rounded-2xl border-4 border-white/35 bg-black/50 py-5 text-center text-3xl font-black text-white placeholder:text-amber-200/60"
                  value={produceOnHand}
                  onChange={(e) =>
                    setProduceOnHand(Number(e.target.value))
                  }
                  placeholder="盤點現存數"
                  disabled={busyLook}
                />
              )}
            </div>
          </div>

          <div className="relative shrink-0 px-4 pb-4">
            {canScan ? (
              <div className="relative mx-auto aspect-square w-full max-w-[92vw] overflow-hidden rounded-3xl bg-black ring-4 ring-white/40">
                <video
                  ref={videoRef}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                  aria-hidden
                />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                  <div className="aspect-square w-[70%] max-w-[17rem] rounded-2xl border-[4px] border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-xl font-black text-amber-200">
                此裝置不支援鏡頭掃碼
              </p>
            )}
          </div>

          {invEcho ? (
            <p className="shrink-0 px-4 text-center text-lg font-black text-red-300">
              {invEcho}
            </p>
          ) : null}
          {errLook ? (
            <p className="shrink-0 px-4 text-center text-lg font-black text-amber-200">
              {errLook}
            </p>
          ) : null}

          <div className="min-h-0 flex-1" />

          <div className="shrink-0 bg-zinc-900 px-4 py-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <textarea
              className="min-h-[5rem] w-full resize-y rounded-2xl border-4 border-white/40 bg-black/55 p-4 font-mono text-lg font-black text-white placeholder:text-lg placeholder:font-black placeholder:text-white/45"
              placeholder="請貼上 QR，按 Enter 送出"
              value={qrPaste}
              onChange={(e) => setQrPaste(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const v = qrPaste.replace(/\uFEFF/g, "").trim();
                  if (v) void fetchRecord(v);
                }
              }}
            />
            {serialLinePreview ? (
              <p className="mt-3 text-center font-mono text-base font-bold text-white/60">
                {serialLinePreview}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
