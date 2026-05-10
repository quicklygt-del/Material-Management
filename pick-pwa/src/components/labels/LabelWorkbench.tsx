"use client";

import { useCallback, useMemo, useState } from "react";
import { parseExcelFirstSheet } from "@/lib/excelSheet";
import {
  buildLabelQrPayload,
  LABEL_OPERATION_UNITS,
  type LabelOperationUnit,
  type LabelTypeCode,
  resolveSerialSource,
} from "@/lib/labelEncoding";
import { getEffectiveLabelPrefix } from "@/lib/labelPrefixEnv";
import {
  bluetoothSendText,
  formatLabelPrintLines,
  isWebBluetoothAvailable,
} from "@/lib/bluetoothPrint";
import { getSessionUser } from "@/lib/auth";
import { LabelPreview, type LabelSizePreset } from "./LabelPreview";

function guessCol(labels: string[], needles: string[]): number {
  const n = (s: string) => s.replace(/\uFEFF/g, "").trim().toLowerCase();
  for (let i = 0; i < labels.length; i += 1) {
    const h = n(labels[i]);
    if (needles.some((k) => h.includes(k))) return i;
  }
  return -1;
}

type BatchRow = { item_no: string; color_code: string };

type Props = {
  typeCode: LabelTypeCode;
  scenarioTitle: string;
  variant?: "default" | "danger";
  enableExcel?: boolean;
  /** `public`：未登入，不寫入伺服器紀錄 */
  authMode?: "session" | "public";
};

async function postLabelRecord(body: {
  label_type: LabelTypeCode;
  qr_payload: string;
  item_no: string;
  color_code: string | null;
  operator_id: string;
  meta: Record<string, unknown>;
}): Promise<void> {
  const res = await fetch("/api/label-records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    ok?: boolean;
  };
  if (!res.ok) {
    throw new Error(json.error || `伺服器錯誤（${res.status}）`);
  }
}

export function LabelWorkbench({
  typeCode,
  scenarioTitle,
  variant = "default",
  enableExcel = false,
  authMode = "session",
}: Props) {
  const session = getSessionUser();
  const labelPrefix = getEffectiveLabelPrefix();

  const [itemNo, setItemNo] = useState("");
  const [colorCode, setColorCode] = useState("");
  const [bundleNo, setBundleNo] = useState("");
  const [contentNote, setContentNote] = useState("");
  const [size, setSize] = useState<LabelSizePreset>("50x30");
  const [operationUnit, setOperationUnit] =
    useState<LabelOperationUnit>("現場");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchIdx, setBatchIdx] = useState(0);

  const operatorId =
    authMode === "public" ? "現場公開" : (session?.username ?? "unknown");

  const isBundle = typeCode === "B";

  const activeItem = useMemo(() => {
    if (enableExcel && batchRows.length > 0) {
      const r = batchRows[batchIdx] ?? batchRows[0];
      return {
        item_no: r.item_no,
        color_code: r.color_code,
      };
    }
    return { item_no: itemNo, color_code: colorCode };
  }, [enableExcel, batchRows, batchIdx, itemNo, colorCode]);

  const serialSource = useMemo(
    () =>
      resolveSerialSource(typeCode, {
        itemNo: activeItem.item_no,
        bundleNo,
        contentNote,
      }),
    [typeCode, activeItem.item_no, bundleNo, contentNote],
  );

  const qrPayload = useMemo(() => {
    try {
      if (typeCode !== "B" && !activeItem.item_no.trim()) return "";
      if (typeCode === "B") {
        const hasAny =
          bundleNo.trim() ||
          activeItem.item_no.trim() ||
          contentNote.trim();
        if (!hasAny) return "";
      }
      return buildLabelQrPayload({
        typeCode,
        serialSource,
      });
    } catch {
      return "";
    }
  }, [
    typeCode,
    activeItem.item_no,
    serialSource,
    bundleNo,
    contentNote,
  ]);

  const headline = useMemo(() => {
    if (isBundle) {
      const parts: string[] = [];
      if (bundleNo.trim()) parts.push(`裝箱 ${bundleNo.trim()}`);
      if (activeItem.item_no.trim()) parts.push(`料號 ${activeItem.item_no.trim()}`);
      if (contentNote.trim()) parts.push(contentNote.trim());
      return parts.length ? parts.join("\n") : "—";
    }
    const parts = [activeItem.item_no.trim()];
    if (activeItem.color_code.trim()) {
      parts.push(`色號 ${activeItem.color_code.trim()}`);
    }
    return parts.filter(Boolean).join(" · ") || "—";
  }, [isBundle, bundleNo, contentNote, activeItem]);

  const footerBase = useMemo(() => {
    const d = new Date();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${ds} · ${operatorId}`;
  }, [operatorId]);

  const footer = `${footerBase} · ${operationUnit}`;

  const recordItemNo = useMemo(() => {
    if (isBundle) {
      return (
        activeItem.item_no.trim() ||
        bundleNo.trim() ||
        "-"
      );
    }
    return activeItem.item_no.trim() || "-";
  }, [isBundle, activeItem.item_no, bundleNo]);

  const saveRecord = useCallback(
    async (payload: string) => {
      if (authMode === "public") return;
      if (!session) {
        throw new Error("無法寫入紀錄：請先登入。");
      }
      await postLabelRecord({
        label_type: typeCode,
        qr_payload: payload,
        item_no: recordItemNo,
        color_code: activeItem.color_code.trim() || null,
        operator_id: operatorId,
        meta: {
          scenario: scenarioTitle,
          operation_unit: operationUnit,
          ...(isBundle
            ? {
                bundle_no: bundleNo.trim() || null,
                content_note: contentNote.trim() || null,
              }
            : {}),
        },
      });
    },
    [
      authMode,
      session,
      labelPrefix,
      typeCode,
      recordItemNo,
      activeItem.color_code,
      operatorId,
      scenarioTitle,
      operationUnit,
      isBundle,
      bundleNo,
      contentNote,
    ],
  );

  const handlePrint = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (authMode !== "public" && !session) {
      setErrorMsg("請先登入後再列印（方可寫入操作紀錄）。");
      return;
    }
    if (!qrPayload) {
      setErrorMsg(
        isBundle
          ? "請至少填寫裝箱單號、料號或內容備註之一"
          : "請輸入料號後再列印",
      );
      return;
    }
    if (!isWebBluetoothAvailable()) {
      setErrorMsg("列印失敗");
      return;
    }
    setBusy(true);
    if (authMode !== "public") {
      try {
        await saveRecord(qrPayload);
      } catch (e) {
        const text =
          e instanceof Error ? e.message : "寫入標籤紀錄失敗，請稍後再試或洽管理員。";
        setErrorMsg(text);
        setBusy(false);
        return;
      }
    }

    try {
      const lines = formatLabelPrintLines({
        qrPayload,
        itemLine: headline,
        footerLine: footerBase,
        title: scenarioTitle,
        operationUnit,
      });
      await bluetoothSendText(lines);
      setSuccessMsg(
        authMode === "public"
          ? "已送出藍牙列印（公開區不寫入伺服器紀錄）"
          : "已送出藍牙列印並完成伺服器紀錄",
      );
      if (enableExcel && batchRows.length > 1 && batchIdx < batchRows.length - 1) {
        setBatchIdx((i) => i + 1);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : "未知錯誤";
      if (authMode === "public") {
        setErrorMsg(`藍牙列印失敗：${detail}。請檢查標籤機電源／距離後再試。`);
      } else {
        setErrorMsg(
          `資料庫已紀錄此筆標籤，但藍牙列印失敗：${detail}。請檢查標籤機電源／距離後再試。`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onExcel = async (file: File | null) => {
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const sheet = await parseExcelFirstSheet(file);
      const labels = sheet.columnLabels;
      const idxItem = guessCol(labels, ["item_no", "料號", "品號", "物料"]);
      const idxColor = guessCol(labels, ["color", "色號", "顏色"]);
      if (idxItem < 0) {
        setErrorMsg("Excel 需含料號欄（標題含：料號／item_no）");
        return;
      }
      const rows: BatchRow[] = [];
      for (const r of sheet.dataRows) {
        const item = String(r[idxItem] ?? "").trim();
        if (!item) continue;
        const color =
          idxColor >= 0 ? String(r[idxColor] ?? "").trim() : "";
        rows.push({ item_no: item, color_code: color });
      }
      if (!rows.length) {
        setErrorMsg("未讀到有效資料列");
        return;
      }
      const uniqNos = Array.from(new Set(rows.map((r) => r.item_no.trim()).filter(Boolean)));
      try {
        const vr = await fetch(
          `${window.location.origin}/api/warehouse-ledger/validate-items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              item_nos: uniqNos,
            }),
          },
        );
        const vj = (await vr.json()) as {
          ok?: boolean;
          missing?: string[];
          error?: string;
        };
        if (!vr.ok) {
          throw new Error(vj.error || `總帳比對失敗（${vr.status}）`);
        }
        if (!vj.ok && (vj.missing?.length ?? 0) > 0) {
          const ms = vj.missing ?? [];
          const sample = ms.slice(0, 35).join("、");
          const more = ms.length > 35 ? ` …等共 ${ms.length} 筆` : "";
          throw new Error(
            `以下料號未建於倉儲總帳，無法載入標籤批次：${sample}${more}。請先至「倉儲總帳」匯入。`,
          );
        }
      } catch (e) {
        if (e instanceof Error) {
          setErrorMsg(e.message);
        } else {
          setErrorMsg("總帳比對發生錯誤");
        }
        setBatchRows([]);
        setBatchIdx(0);
        return;
      }
      setBatchRows(rows);
      setBatchIdx(0);
      setItemNo(rows[0].item_no);
      setColorCode(rows[0].color_code);
      setSuccessMsg(`已載入 ${rows.length} 筆，請預覽後逐筆藍牙列印`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "讀檔失敗");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">資料</h2>
        <p className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">
          標籤前綴：<span className="font-mono text-sm text-slate-900">{labelPrefix}</span>
        </p>
        <div className="mt-3 grid gap-3">
          {!enableExcel && isBundle && (
            <>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                裝箱單號
                <input
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                  value={bundleNo}
                  onChange={(e) => setBundleNo(e.target.value)}
                  placeholder="建議填寫"
                />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                料號（選填）
                <input
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                  value={itemNo}
                  onChange={(e) => setItemNo(e.target.value)}
                  placeholder="可空白"
                />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                內容備註
                <textarea
                  className="min-h-[80px] rounded-lg border border-slate-300 px-3 py-2 font-bold"
                  value={contentNote}
                  onChange={(e) => setContentNote(e.target.value)}
                  placeholder="箱內說明、批號等"
                />
              </label>
            </>
          )}
          {!enableExcel && !isBundle && (
            <>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                料號
                <input
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                  value={itemNo}
                  onChange={(e) => setItemNo(e.target.value)}
                  placeholder="必填"
                />
              </label>
              <label className="grid gap-1 text-sm font-bold text-slate-700">
                色號（選填）
                <input
                  className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                  value={colorCode}
                  onChange={(e) => setColorCode(e.target.value)}
                />
              </label>
            </>
          )}
          {enableExcel && (
            <div className="grid gap-2">
              <label className="text-sm font-bold text-slate-700">
                採購單 Excel（需含料號欄）
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                className="text-sm font-bold"
                onChange={(e) => void onExcel(e.target.files?.[0] ?? null)}
              />
              {batchRows.length > 0 && (
                <p className="text-sm font-semibold text-slate-600">
                  批次第 {batchIdx + 1}／{batchRows.length} 筆 — 料號{" "}
                  {activeItem.item_no}
                </p>
              )}
            </div>
          )}
          <label className="grid gap-1 text-sm font-bold text-slate-700">
            標籤尺寸
            <select
              className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
              value={size}
              onChange={(e) => setSize(e.target.value as LabelSizePreset)}
            >
              <option value="50x30">50 × 30 mm</option>
              <option value="40x20">40 × 20 mm</option>
              <option value="30x30">30 × 30 mm（正方）</option>
              <option value="20x20">20 × 20 mm（正方）</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-lg font-black text-slate-900">預覽</h2>
        <p className="mt-1 text-xs font-semibold text-slate-600">
          QR 容錯：Level H（約 30%）；列印請維持對比與清晰。
        </p>
        <div className="mt-4 flex justify-center print:mt-0">
          {qrPayload ? (
            <LabelPreview
              qrValue={qrPayload}
              headline={headline}
              footer={footer}
              size={size}
              variant={variant}
            />
          ) : (
            <p className="py-8 text-center font-bold text-slate-400">
              {isBundle
                ? "請填寫裝箱單號、料號或備註後顯示預覽"
                : "請輸入料號後顯示預覽"}
            </p>
          )}
        </div>
        <p className="mt-3 break-all text-center text-[10px] font-mono text-slate-500">
          {qrPayload || "—"}
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <label className="grid shrink-0 gap-1 text-sm font-bold text-slate-700 sm:w-40">
          操作單位
          <select
            className="min-h-[48px] rounded-lg border-2 border-slate-400 bg-white px-2 font-black text-slate-900"
            value={operationUnit}
            onChange={(e) =>
              setOperationUnit(e.target.value as LabelOperationUnit)
            }
          >
            {LABEL_OPERATION_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !qrPayload}
          onClick={() => void handlePrint()}
          className="min-h-[56px] flex-1 rounded-xl bg-blue-800 text-lg font-black text-white disabled:opacity-40"
        >
          {busy ? "處理中…" : "藍牙列印"}
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-center text-sm font-black text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {successMsg && !errorMsg && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-center text-sm font-black text-emerald-900">
          {successMsg}
        </div>
      )}

    </div>
  );
}
