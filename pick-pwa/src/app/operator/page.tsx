"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [scanInput, setScanInput] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [qty, setQty] = useState("1");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    label_record_id: string;
    qr_payload: string;
    item_no: string;
    item_name?: string;
    spec?: string;
    on_hand?: number;
  } | null>(null);

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

  const runLookup = async () => {
    const qr = scanInput.trim();
    if (!qr) {
      setScanMsg("請先輸入或掃描 QR / 料號");
      return;
    }
    setLookupBusy(true);
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
      setScanMsg("辨識成功，可執行領料或退料。");
    } catch (e) {
      setDetail(null);
      setScanMsg(e instanceof Error ? e.message : "辨識失敗");
    } finally {
      setLookupBusy(false);
    }
  };

  const submitMove = async (action: "pick" | "return") => {
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
      setScanMsg(action === "pick" ? "領料成功，已更新庫存與交易紀錄。" : "退料成功，已更新庫存與交易紀錄。");
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "庫存異動失敗");
    } finally {
      setMoveBusy(false);
    }
  };

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
        <h2 className="text-lg font-black text-slate-900">掃描辨識</h2>
        <p className="mt-1 text-xs font-semibold text-slate-600">
          掃描或貼上 QR 後可顯示物料詳情，並執行領料/退料。
        </p>
        <div className="mt-3 space-y-2">
          <input
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
            placeholder="請輸入或掃描 QR / 料號"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runLookup();
            }}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 sm:col-span-2"
              placeholder="單號（選填）"
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
            />
            <input
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
              placeholder="數量"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <button
            type="button"
            onClick={() => void runLookup()}
            disabled={lookupBusy}
            className="h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white disabled:opacity-50"
          >
            {lookupBusy ? "辨識中..." : "顯示物料詳情"}
          </button>
        </div>

        {detail ? (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-slate-800">
            <p>料號：{detail.item_no}</p>
            <p>
              品名：{detail.item_name || "-"}
              {detail.spec ? ` (${detail.spec})` : ""}
            </p>
            <p>目前庫存：{Number(detail.on_hand ?? 0)}</p>
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void submitMove("pick")}
            disabled={moveBusy || !detail}
            className="h-11 rounded-xl bg-blue-700 text-sm font-black text-white disabled:opacity-40"
          >
            領料
          </button>
          <button
            type="button"
            onClick={() => void submitMove("return")}
            disabled={moveBusy || !detail}
            className="h-11 rounded-xl bg-emerald-700 text-sm font-black text-white disabled:opacity-40"
          >
            退料
          </button>
        </div>
        {scanMsg ? (
          <p className="mt-2 text-xs font-bold text-slate-700">{scanMsg}</p>
        ) : null}
      </section>

      <WarehouseStyleTaskDeck assignedOperator={username} />
    </main>
  );
}
