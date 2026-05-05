"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseExcelFirstSheet } from "@/lib/excelSheet";
import {
  buildLabelQrPayload,
  LABEL_OPERATION_UNITS,
  type LabelOperationUnit,
  type LabelTypeCode,
  resolveSerialSource,
} from "@/lib/labelEncoding";
import { useQrCenterTenant } from "@/lib/qrCenterTenant";
import {
  bluetoothSendText,
  formatLabelPrintLines,
  isWebBluetoothAvailable,
} from "@/lib/bluetoothPrint";
import {
  LabelPreview,
  type LabelSizePreset,
  type LabelVisualTemplate,
} from "@/components/labels/LabelPreview";

const WORKFLOW_MODES = [
  "general",
  "surplus_rq",
  "bundle",
  "rnd",
  "qc",
] as const;
export type QrWorkflowMode = (typeof WORKFLOW_MODES)[number];

const MODE_LABEL: Record<QrWorkflowMode, string> = {
  general: "一般模式（讀取 ERP／料號）",
  surplus_rq: "餘料模式（RQ）",
  bundle: "裝箱模式（多料關聯建檔）",
  rnd: "自定義資產",
  qc: "不良品",
};

function guessCol(labels: string[], needles: string[]): number {
  const n = (s: string) => s.replace(/\uFEFF/g, "").trim().toLowerCase();
  for (let i = 0; i < labels.length; i += 1) {
    const h = n(labels[i]);
    if (needles.some((k) => h.includes(k))) return i;
  }
  return -1;
}

type BatchRow = {
  item_no: string;
  color_code: string;
  product_name: string;
  spec: string;
};

function workflowToLabelType(mode: QrWorkflowMode): LabelTypeCode {
  if (mode === "general") return "S";
  if (mode === "surplus_rq") return "R";
  if (mode === "bundle") return "B";
  if (mode === "rnd") return "D";
  return "Q";
}

export function QrCenterGenerator() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenantId } = useQrCenterTenant();

  const [mode, setMode] = useState<QrWorkflowMode>("general");
  useEffect(() => {
    const m = searchParams.get("mode");
    if (
      m === "general" ||
      m === "surplus_rq" ||
      m === "bundle" ||
      m === "rnd" ||
      m === "qc"
    ) {
      setMode(m);
    }
  }, [searchParams]);

  const syncModeUrl = useCallback(
    (m: QrWorkflowMode) => {
      setMode(m);
      const t = new URLSearchParams();
      t.set("mode", m);
      router.replace(`/qr-center?${t.toString()}`, { scroll: false });
    },
    [router],
  );

  const [itemNo, setItemNo] = useState("");
  const [colorCode, setColorCode] = useState("");
  /** 一般模式、非批次時手動輸入 */
  const [generalProductName, setGeneralProductName] = useState("");
  const [generalSpec, setGeneralSpec] = useState("");
  const [surplusQty, setSurplusQty] = useState("");
  const [prevOperator, setPrevOperator] = useState("");
  const [bundleScans, setBundleScans] = useState("");
  const [bundleNote, setBundleNote] = useState("");
  const [rndProject, setRndProject] = useState("");
  const [description, setDescription] = useState("");

  const [size, setSize] = useState<LabelSizePreset>("50x30");
  const [operationUnit, setOperationUnit] =
    useState<LabelOperationUnit>("現場");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchIdx, setBatchIdx] = useState(0);

  const labelType = workflowToLabelType(mode);

  const activeItem = useMemo(() => {
    if (mode === "general" && batchRows.length > 0) {
      const r = batchRows[batchIdx] ?? batchRows[0];
      return {
        item_no: r.item_no,
        color_code: r.color_code,
        product_name: r.product_name,
        spec: r.spec,
      };
    }
    if (mode === "general") {
      return {
        item_no: itemNo,
        color_code: colorCode,
        product_name: generalProductName,
        spec: generalSpec,
      };
    }
    return {
      item_no: itemNo,
      color_code: colorCode,
      product_name: "",
      spec: "",
    };
  }, [
    mode,
    batchRows,
    batchIdx,
    itemNo,
    colorCode,
    generalProductName,
    generalSpec,
  ]);

  const patchBatchRow = useCallback(
    (patch: Partial<BatchRow>) => {
      setBatchRows((rows) => {
        if (rows.length === 0) return rows;
        const next = [...rows];
        const i = Math.min(batchIdx, next.length - 1);
        const cur = next[i];
        if (!cur) return rows;
        next[i] = {
          item_no: patch.item_no ?? cur.item_no,
          color_code: patch.color_code ?? cur.color_code,
          product_name: patch.product_name ?? cur.product_name,
          spec: patch.spec ?? cur.spec,
        };
        return next;
      });
    },
    [batchIdx],
  );

  const bundleLines = useMemo(
    () =>
      bundleScans
        .split(/\r?\n/)
        .map((s) => s.replace(/\uFEFF/g, "").trim())
        .filter(Boolean),
    [bundleScans],
  );

  const bundleContentsJson = useMemo(
    () => bundleLines.map((qr_payload) => ({ qr_payload })),
    [bundleLines],
  );

  const serialSource = useMemo(() => {
    if (mode === "bundle") {
      const joined = bundleLines.join("|");
      return resolveSerialSource("B", {
        itemNo: joined,
        bundleNo: bundleNote,
        contentNote: bundleNote,
      });
    }
    if (mode === "rnd") {
      return resolveSerialSource("D", {
        itemNo: "",
        bundleNo: "",
        contentNote: description,
        rndProject,
        rndOwner: "",
      });
    }
    return resolveSerialSource(labelType, {
      itemNo: activeItem.item_no,
      bundleNo: "",
      contentNote: "",
    });
  }, [
    mode,
    labelType,
    activeItem.item_no,
    bundleLines,
    bundleNote,
    description,
    rndProject,
  ]);

  const qrPayload = useMemo(() => {
    try {
      if (mode === "general" && !activeItem.item_no.trim()) return "";
      if (mode === "surplus_rq" && !activeItem.item_no.trim()) return "";
      if (mode === "qc" && !activeItem.item_no.trim()) return "";
      if (mode === "bundle" && bundleLines.length === 0 && !bundleNote.trim()) {
        return "";
      }
      if (mode === "rnd" && !rndProject.trim() && !description.trim()) {
        return "";
      }
      return buildLabelQrPayload({
        typeCode: labelType,
        serialSource,
      });
    } catch {
      return "";
    }
  }, [
    mode,
    labelType,
    activeItem.item_no,
    bundleLines.length,
    bundleNote,
    rndProject,
    description,
    serialSource,
  ]);

  const headline = useMemo(() => {
    if (mode === "rnd") {
      const parts: string[] = [];
      if (rndProject.trim()) parts.push(rndProject.trim());
      if (description.trim()) parts.push(description.trim());
      return parts.length ? parts.join("\n") : "—";
    }
    if (mode === "bundle") {
      const parts: string[] = [];
      if (bundleNote.trim()) parts.push(`箱註 ${bundleNote.trim()}`);
      parts.push(`內含 ${bundleLines.length} 筆掃描`);
      return parts.join("\n");
    }
    if (mode === "surplus_rq") {
      const parts = [activeItem.item_no.trim()];
      if (surplusQty.trim()) parts.push(`餘量 ${surplusQty.trim()}`);
      if (prevOperator.trim()) parts.push(`前次 ${prevOperator.trim()}`);
      return parts.filter(Boolean).join("\n") || "—";
    }
    if (mode === "general") {
      const parts: string[] = [];
      if (activeItem.item_no.trim()) parts.push(activeItem.item_no.trim());
      if (activeItem.product_name.trim()) parts.push(activeItem.product_name.trim());
      if (activeItem.spec.trim()) parts.push(`規格 ${activeItem.spec.trim()}`);
      if (activeItem.color_code.trim()) parts.push(`色號 ${activeItem.color_code.trim()}`);
      return parts.length ? parts.join("\n") : "—";
    }
    const parts = [activeItem.item_no.trim()];
    if (activeItem.color_code.trim()) parts.push(`色號 ${activeItem.color_code.trim()}`);
    return parts.filter(Boolean).join("\n") || "—";
  }, [
    mode,
    rndProject,
    description,
    bundleNote,
    bundleLines.length,
    surplusQty,
    prevOperator,
    activeItem,
  ]);

  const footerBase = useMemo(() => {
    const d = new Date();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${ds} · 現場公開`;
  }, []);

  const footer = `${footerBase} · ${operationUnit}`;

  const visualTemplate: LabelVisualTemplate =
    mode === "rnd" ? "rnd_header" : mode === "qc" ? "defect_stamp" : "default";

  const recordItemNo = useMemo(() => {
    if (mode === "rnd")
      return rndProject.trim() || description.trim().slice(0, 120) || "-";
    if (mode === "bundle") return bundleNote.trim() || `BOX-${bundleLines.length}`;
    return activeItem.item_no.trim() || "-";
  }, [mode, rndProject, description, bundleNote, bundleLines.length, activeItem.item_no]);

  const postRecord = useCallback(async () => {
    const meta: Record<string, unknown> = {
      workflow_mode: mode,
      operation_unit: operationUnit,
      description: description.trim() || null,
    };
    if (mode === "general") {
      meta.product_name = activeItem.product_name.trim() || null;
      meta.spec = activeItem.spec.trim() || null;
    }
    if (mode === "surplus_rq") {
      meta.surplus_qty = surplusQty.trim() || null;
      meta.previous_operator = prevOperator.trim() || null;
    }
    if (mode === "bundle") {
      meta.contents = bundleContentsJson;
      meta.bundle_scan_count = bundleLines.length;
      meta.bundle_note = bundleNote.trim() || null;
    }
    if (mode === "rnd") {
      meta.project_name = rndProject.trim() || null;
    }

    const res = await fetch("/api/label-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        label_type: labelType,
        qr_payload: qrPayload,
        item_no: recordItemNo,
        color_code: activeItem.color_code.trim() || null,
        operator_id: "現場公開",
        meta,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error || `伺服器錯誤 ${res.status}`);
  }, [
    tenantId,
    mode,
    operationUnit,
    description,
    surplusQty,
    prevOperator,
    bundleContentsJson,
    bundleLines.length,
    bundleNote,
    rndProject,
    labelType,
    qrPayload,
    recordItemNo,
    activeItem.color_code,
    activeItem.product_name,
    activeItem.spec,
  ]);

  const handlePrint = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!qrPayload) {
      setErrorMsg("請完成必填欄位後再列印");
      return;
    }
    if (!isWebBluetoothAvailable()) {
      setErrorMsg("列印失敗");
      return;
    }
    setBusy(true);
    try {
      await postRecord();
    } catch (e) {
      setErrorMsg(
        e instanceof Error
          ? `${e.message}（未列印：資料未寫入成功不可印標）`
          : "寫入失敗，已取消列印",
      );
      setBusy(false);
      return;
    }

    try {
      const lines = formatLabelPrintLines({
        qrPayload,
        itemLine: headline,
        footerLine: footerBase,
        title: MODE_LABEL[mode],
        operationUnit,
      });
      await bluetoothSendText(lines);
      setSuccessMsg("已建檔並送出列印");
      if (mode === "general" && batchRows.length > 1 && batchIdx < batchRows.length - 1) {
        setBatchIdx((i) => i + 1);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : "";
      setErrorMsg(`資料已入庫，但列印失敗：${detail}`);
    } finally {
      setBusy(false);
    }
  };

  const onExcel = async (file: File | null) => {
    if (!file || mode !== "general") return;
    setErrorMsg(null);
    try {
      const sheet = await parseExcelFirstSheet(file);
      const labels = sheet.columnLabels;
      const idxItem = guessCol(labels, ["item_no", "料號", "品號", "物料"]);
      const idxColor = guessCol(labels, ["color", "色號", "顏色"]);
      const idxName = guessCol(labels, [
        "品名",
        "product_name",
        "產品名稱",
        "物料名稱",
        "品名說明",
      ]);
      const idxSpec = guessCol(labels, ["規格", "spec", "型號", "規格說明"]);
      if (idxItem < 0) {
        setErrorMsg("Excel 需含料號欄");
        return;
      }
      const rows: BatchRow[] = [];
      for (const r of sheet.dataRows) {
        const item = String(r[idxItem] ?? "").trim();
        if (!item) continue;
        const color =
          idxColor >= 0 ? String(r[idxColor] ?? "").trim() : "";
        const product_name =
          idxName >= 0 ? String(r[idxName] ?? "").trim() : "";
        const spec = idxSpec >= 0 ? String(r[idxSpec] ?? "").trim() : "";
        rows.push({ item_no: item, color_code: color, product_name, spec });
      }
      if (!rows.length) {
        setErrorMsg("未讀到有效資料列");
        return;
      }
      setBatchRows(rows);
      setBatchIdx(0);
      setItemNo(rows[0].item_no);
      setColorCode(rows[0].color_code);
      setGeneralProductName(rows[0].product_name);
      setGeneralSpec(rows[0].spec);
      setSuccessMsg(
        `已載入 ${rows.length} 筆（含品名／規格欄位時會一併帶入）`,
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "讀檔失敗");
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-24 pt-3 sm:px-5">
      <div className="mb-4 flex justify-end rounded-xl border border-amber-200 bg-white p-3 shadow-sm">
        <Link
          href="/qr-center/scan"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border-2 border-blue-700 bg-blue-50 px-4 text-sm font-black text-blue-900"
        >
          掃描辨識
        </Link>
      </div>

      <label className="grid gap-2 font-bold text-slate-800">
        <span className="text-sm">模式</span>
        <select
          className="min-h-[52px] rounded-xl border-2 border-slate-400 bg-white px-3 text-base font-black text-slate-900 shadow-inner"
          value={mode}
          onChange={(e) => syncModeUrl(e.target.value as QrWorkflowMode)}
        >
          {WORKFLOW_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      <section className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">欄位</h2>

        {mode === "general" && (
          <>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              採購／ERP Excel（選填，批次料號）
              <input
                type="file"
                accept=".xlsx,.xls"
                className="text-sm"
                onChange={(e) => void onExcel(e.target.files?.[0] ?? null)}
              />
            </label>
            {batchRows.length > 0 && (
              <p className="text-sm font-semibold text-blue-800">
                批次 {batchIdx + 1}／{batchRows.length}
              </p>
            )}
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              料號
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-lg font-black"
                value={activeItem.item_no}
                onChange={(e) => {
                  const v = e.target.value;
                  if (batchRows.length > 0) patchBatchRow({ item_no: v });
                  else setItemNo(v);
                }}
                placeholder="必填"
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              品名（選填）
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={activeItem.product_name}
                onChange={(e) => {
                  const v = e.target.value;
                  if (batchRows.length > 0) patchBatchRow({ product_name: v });
                  else setGeneralProductName(v);
                }}
                placeholder="可手動輸入或由 Excel 帶入"
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              規格（選填）
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={activeItem.spec}
                onChange={(e) => {
                  const v = e.target.value;
                  if (batchRows.length > 0) patchBatchRow({ spec: v });
                  else setGeneralSpec(v);
                }}
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              色號（選填）
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={activeItem.color_code}
                onChange={(e) => {
                  const v = e.target.value;
                  if (batchRows.length > 0) patchBatchRow({ color_code: v });
                  else setColorCode(v);
                }}
              />
            </label>
          </>
        )}

        {mode === "surplus_rq" && (
          <>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              料號
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-lg font-black"
                value={itemNo}
                onChange={(e) => setItemNo(e.target.value)}
                placeholder="必填"
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              剩餘數量
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-black"
                inputMode="decimal"
                value={surplusQty}
                onChange={(e) => setSurplusQty(e.target.value)}
                placeholder="例：12"
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              前次操作者（註記）
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={prevOperator}
                onChange={(e) => setPrevOperator(e.target.value)}
              />
            </label>
          </>
        )}

        {mode === "bundle" && (
          <>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              掃描／貼上物料 QR（每行一筆完整字串）
              <textarea
                className="min-h-[140px] rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-bold"
                value={bundleScans}
                onChange={(e) => setBundleScans(e.target.value)}
                placeholder="WMS-S-xxxxx&#10;WMS-R-xxxxx"
              />
            </label>
            <p className="text-xs font-semibold text-slate-600">
              已輸入 {bundleLines.length} 筆；將寫入 meta.contents JSON。
            </p>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              裝箱說明／箱號備註
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={bundleNote}
                onChange={(e) => setBundleNote(e.target.value)}
              />
            </label>
          </>
        )}

        {mode === "rnd" && (
          <>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              名稱
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-black"
                value={rndProject}
                onChange={(e) => setRndProject(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              描述
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-bold"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </>
        )}

        {mode === "qc" && (
          <>
            <label className="grid gap-1 text-sm font-bold text-slate-700">
              料號（不良品）
              <input
                className="min-h-[48px] rounded-lg border border-slate-300 px-3 text-lg font-black"
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

        {mode !== "rnd" && (
          <label className="grid gap-1 text-sm font-bold text-slate-700">
            描述（寫入紀錄）
            <input
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 font-bold"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="選填"
            />
          </label>
        )}

        <label className="grid gap-1 text-sm font-bold text-slate-700">
          標籤尺寸
          <select
            className="min-h-[48px] rounded-lg border border-slate-300 px-3 font-black"
            value={size}
            onChange={(e) => setSize(e.target.value as LabelSizePreset)}
          >
            <option value="50x30">50 × 30 mm</option>
            <option value="40x20">40 × 20 mm</option>
            <option value="30x30">30 × 30 mm</option>
            <option value="20x20">20 × 20 mm</option>
          </select>
        </label>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-lg font-black text-slate-900">預覽</h2>
        <div className="mt-4 flex justify-center overflow-x-auto">
          {qrPayload ? (
            <LabelPreview
              qrValue={qrPayload}
              headline={headline}
              footer={footer}
              size={size}
              template={visualTemplate}
            />
          ) : (
            <p className="py-10 text-center font-bold text-slate-400">
              請完成欄位以顯示預覽
            </p>
          )}
        </div>
        <p className="mt-3 break-all text-center font-mono text-[10px] text-slate-500">
          {qrPayload || "—"}
        </p>
      </section>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <label className="grid shrink-0 gap-1 text-sm font-bold text-slate-700 sm:w-36">
          操作單位
          <select
            className="min-h-[52px] rounded-lg border-2 border-slate-400 bg-white px-2 font-black"
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
          {busy ? "處理中…" : "寫入並列印"}
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mt-4 rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-center text-sm font-black text-red-900"
        >
          {errorMsg}
        </div>
      )}
      {successMsg && !errorMsg && (
        <div className="mt-4 rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-3 text-center font-black text-emerald-900">
          {successMsg}
        </div>
      )}

    </main>
  );
}
