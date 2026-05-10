"use client";

import { Bluetooth } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deriveItemNoForRecord,
  getDefaultLabelTemplateFields,
  humanDescribeTemplateColumns,
  parseExcelLabelBatchWithTemplate,
  type ExcelLabelBatchItem,
  type LabelTemplateField,
} from "@/lib/labelPrintTemplate";
import { appHref } from "@/lib/appHref";

const QR_MAX = 1200;

const NOT_FOUND_HINT = "（未查獲料號，請手動輸入）";

type UnitCtxLite = {
  unit_id: string;
  slug: string;
  name: string;
  label_template_id: string | null;
};

const DEFAULT_ACTION = "pick" as const;
const DEFAULT_QTY = 1;
const PRINT_COUNT_CAP = 9999;

type PrintFmt =
  | "a4"
  | "label-30x20"
  | "label-50x30"
  | "label-80x45"
  | "label-40x40"
  | "label-100x150"
  | "custom";

type MaterialTab = "raw" | "special";

function clampMm(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(500, Math.max(10, Math.round(n)));
}

function qrSizesFor(printSize: PrintFmt, cw: number, ch: number) {
  switch (printSize) {
    case "a4":
      return { preview: 280, print: 480 };
    case "label-30x20":
      return { preview: 96, print: 112 };
    case "label-50x30":
      return { preview: 200, print: 200 };
    case "label-80x45":
      return { preview: 220, print: 300 };
    case "label-40x40":
      return { preview: 160, print: 200 };
    case "label-100x150":
      return { preview: 168, print: 360 };
    default: {
      const m = Math.min(clampMm(cw), clampMm(ch));
      const preview = Math.min(240, Math.max(72, Math.floor(m * 3.6)));
      const print = Math.min(420, Math.max(96, Math.floor(m * 5.5)));
      return { preview, print };
    }
  }
}

function buildQrFromManual(
  fields: LabelTemplateField[],
  itemNo: string,
  itemName: string,
  spec: string,
): string {
  const nameTrim = itemName.trim();
  const specTrim = spec.trim();
  const effectiveName = nameTrim === NOT_FOUND_HINT ? "" : nameTrim;
  const parts: string[] = [];
  for (const f of fields) {
    if (f.key === "print_count") continue;
    switch (f.key) {
      case "item_no":
        parts.push(itemNo.trim());
        break;
      case "item_name":
        parts.push(effectiveName);
        break;
      case "spec":
        parts.push(specTrim);
        break;
      case "batch_no":
      case "supplier_code":
      case "remark":
        parts.push("");
        break;
      default:
        parts.push("");
    }
  }
  return parts.join("\n");
}

export default function UnitLabelPrintPage() {
  const router = useRouter();
  const params = useParams();
  const slugParam = decodeURIComponent(String(params.slug ?? ""));
  const [ctx, setCtx] = useState<UnitCtxLite | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [materialTab, setMaterialTab] = useState<MaterialTab>("raw");
  const [itemNo, setItemNo] = useState("");
  const [itemName, setItemName] = useState("");
  const [spec, setSpec] = useState("");
  const [matchedFromMaster, setMatchedFromMaster] = useState(false);

  const [printSize, setPrintSize] = useState<PrintFmt>("label-50x30");
  const [customWmm, setCustomWmm] = useState(50);
  const [customHmm, setCustomHmm] = useState(30);
  const [printCopiesStr, setPrintCopiesStr] = useState("1");
  const [excelBatch, setExcelBatch] = useState<{
    items: ExcelLabelBatchItem[];
  } | null>(null);
  const [excelFileStatus, setExcelFileStatus] = useState<string | null>(null);

  const [labelFields, setLabelFields] = useState<LabelTemplateField[]>(() =>
    getDefaultLabelTemplateFields(),
  );

  const [btDeviceLabel, setBtDeviceLabel] = useState<string | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const excelBatchEnabled = useMemo(
    () => labelFields.some((f) => f.key === "print_count"),
    [labelFields],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as Partial<UnitCtxLite> & {
        error?: string;
        label_fields?: LabelTemplateField[];
      };
      if (!alive) return;
      if (!res.ok) {
        setCtxErr(j.error ?? "無法載入身分");
        return;
      }
      setCtx({
        unit_id: String(j.unit_id ?? ""),
        slug: String(j.slug ?? ""),
        name: String(j.name ?? ""),
        label_template_id: j.label_template_id
          ? String(j.label_template_id)
          : null,
      });
      if (Array.isArray(j.label_fields) && j.label_fields.length > 0) {
        setLabelFields(j.label_fields);
      } else {
        setLabelFields(getDefaultLabelTemplateFields());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const clearExcelBatch = useCallback(() => {
    setExcelBatch(null);
    setExcelFileStatus(null);
  }, []);

  useEffect(() => {
    if (excelBatch) return;
    setContent(
      buildQrFromManual(labelFields, itemNo, itemName, spec),
    );
  }, [excelBatch, labelFields, itemNo, itemName, spec]);

  const lookupMaterial = useCallback(async () => {
    const key = itemNo.trim();
    if (!key) {
      setItemName("");
      setSpec("");
      setMatchedFromMaster(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/material-master/lookup?item_no=${encodeURIComponent(key)}`,
      );
      const j = (await res.json().catch(() => ({}))) as {
        found?: boolean;
        item_name?: string;
        spec?: string;
        error?: string;
      };
      if (!res.ok && j.error) {
        setItemName(NOT_FOUND_HINT);
        setSpec("");
        setMatchedFromMaster(false);
        return;
      }
      if (j.found) {
        setItemName(j.item_name ?? "");
        setSpec(j.spec ?? "");
        setMatchedFromMaster(true);
      } else {
        setItemName(NOT_FOUND_HINT);
        setSpec("");
        setMatchedFromMaster(false);
      }
    } catch {
      setItemName(NOT_FOUND_HINT);
      setSpec("");
      setMatchedFromMaster(false);
    }
  }, [itemNo]);

  const onItemNoKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void lookupMaterial();
    }
  };

  const qrValue = content.trim().slice(0, QR_MAX);
  const excelLocked = Boolean(excelBatch);

  const manualPrintCopies = useMemo(() => {
    const s = printCopiesStr.trim().replace(/,/g, "");
    if (!s) return 1;
    const n = Math.floor(Number(s));
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(PRINT_COUNT_CAP, n);
  }, [printCopiesStr]);

  const previewQrPayload = useMemo(() => {
    if (excelBatch?.items[0]) {
      return excelBatch.items[0].qrText.trim().slice(0, QR_MAX);
    }
    return qrValue;
  }, [excelBatch, qrValue]);

  const printSlots = useMemo(() => {
    if (excelBatch) {
      return excelBatch.items.flatMap((it) =>
        Array.from({ length: it.printCount }, () =>
          it.qrText.trim().slice(0, QR_MAX),
        ),
      );
    }
    if (!qrValue) return [];
    return Array.from({ length: manualPrintCopies }, () => qrValue);
  }, [excelBatch, manualPrintCopies, qrValue]);

  const excelTotalItems = excelBatch?.items.length ?? 0;
  const excelTotalSheets =
    excelBatch?.items.reduce((s, it) => s + it.printCount, 0) ?? 0;

  const { preview: previewSize, print: printQrSize } = useMemo(
    () => qrSizesFor(printSize, customWmm, customHmm),
    [printSize, customWmm, customHmm],
  );

  const previewQrSize = previewSize;
  const printQrSizeAdjusted = printQrSize;

  const pageCss = useMemo(() => {
    let size: string;
    let margin: string;
    switch (printSize) {
      case "a4":
        size = "A4 portrait";
        margin = "12mm";
        break;
      case "label-30x20":
        size = "30mm 20mm";
        margin = "0";
        break;
      case "label-50x30":
        size = "50mm 30mm";
        margin = "0";
        break;
      case "label-80x45":
        size = "80mm 45mm";
        margin = "0";
        break;
      case "label-40x40":
        size = "40mm 40mm";
        margin = "0";
        break;
      case "label-100x150":
        size = "100mm 150mm";
        margin = "0";
        break;
      default:
        size = `${clampMm(customWmm)}mm ${clampMm(customHmm)}mm`;
        margin = "0";
        break;
    }
    return `@page { size: ${size}; margin: ${margin}; }`;
  }, [printSize, customWmm, customHmm]);

  const postLabelRecordOne = useCallback(
    async (qrPayload: string): Promise<void> => {
      const trimmed = qrPayload.trim().slice(0, QR_MAX);
      if (!ctx || !trimmed) {
        setMsg("請輸入內容");
        throw new Error("請輸入內容");
      }
      const itemNoRec = deriveItemNoForRecord(trimmed, labelFields);
      const res = await fetch("/api/label-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label_type: "UNIVERSAL",
          qr_payload: trimmed,
          item_no: itemNoRec,
          color_code: null,
          operator_id: "unit_label_print",
          meta: {
            workflow_mode: "universal_unit_ledger",
            unit_id: ctx.unit_id,
            user_content: trimmed,
            ledger_action: DEFAULT_ACTION,
            ledger_qty: DEFAULT_QTY,
            print_size: printSize,
            label_template_id: ctx.label_template_id,
            ...(excelBatch
              ? { excel_batch_print: true as const }
              : {}),
            ...(printSize === "custom"
              ? {
                  print_custom_mm_w: clampMm(customWmm),
                  print_custom_mm_h: clampMm(customHmm),
                }
              : {}),
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "寫入標籤紀錄失敗");
    },
    [ctx, customHmm, customWmm, excelBatch, labelFields, printSize],
  );

  const saveThenPrint = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (printSlots.length === 0) {
        setMsg("請輸入內容");
        return;
      }
      for (const payload of printSlots) {
        await postLabelRecordOne(payload);
      }
      requestAnimationFrame(() => {
        window.print();
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "失敗");
    } finally {
      setBusy(false);
    }
  }, [postLabelRecordOne, printSlots]);

  const excelColumnHint = humanDescribeTemplateColumns(labelFields);
  const printCountOrdinal =
    excelBatchEnabled
      ? labelFields.findIndex((f) => f.key === "print_count") + 1
      : 0;

  const ingestExcelBuffer = useCallback(
    (buf: ArrayBuffer, fileLabel: string) => {
      try {
        const items = parseExcelLabelBatchWithTemplate(buf, labelFields);
        setExcelBatch({ items });
        setContent(items[0]?.qrText ?? "");
        setPrintCopiesStr("1");
        setExcelFileStatus(`✅ 已載入清單：${fileLabel}`);
        setMsg(null);
      } catch (err) {
        setExcelFileStatus(null);
        setMsg(
          err instanceof Error ? err.message : "Excel 解析失敗",
        );
      }
    },
    [labelFields],
  );

  const processExcelFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setMsg(null);
      const reader = new FileReader();
      reader.onload = () => {
        const buf = reader.result;
        if (!(buf instanceof ArrayBuffer)) {
          setMsg("無法讀取檔案");
          setExcelFileStatus(null);
          return;
        }
        ingestExcelBuffer(buf, file.name);
      };
      reader.onerror = () => {
        setMsg("讀取檔案失敗");
        setExcelFileStatus(null);
      };
      reader.readAsArrayBuffer(file);
    },
    [ingestExcelBuffer],
  );

  const onExcelSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      processExcelFile(file);
    },
    [processExcelFile],
  );

  const onExcelDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (
        f &&
        /\.(xlsx|xls)$/i.test(f.name) &&
        (f.type ===
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          f.type === "application/vnd.ms-excel" ||
          f.type === "")
      ) {
        processExcelFile(f);
      }
    },
    [processExcelFile],
  );

  const requestBluetoothPrinter = useCallback(async () => {
    setMsg(null);
    const bt =
      typeof navigator !== "undefined" ? navigator.bluetooth : undefined;
    if (!bt) {
      setMsg(
        "此環境無 Web Bluetooth。請改用 Chrome／Edge（HTTPS），或於系統設定配對標籤機後，於列印視窗選擇藍牙印表機。",
      );
      return;
    }
    try {
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: [],
      });
      try {
        await device.gatt?.connect();
      } catch {
        void 0;
      }
      const name =
        String((device as { name?: string | null }).name ?? "")
          .trim() || "藍牙裝置";
      setBtDeviceLabel(name);
      setMsg(`已選取：${name}。列印時請在系統列印視窗選擇對應印表機。`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") {
        return;
      }
      setMsg(
        e instanceof Error
          ? e.message
          : "藍牙選取失敗，仍可透過列印對話框選擇印表機。",
      );
    }
  }, []);

  const customInvalid =
    printSize === "custom" &&
    (!Number.isFinite(customWmm) ||
      !Number.isFinite(customHmm) ||
      customWmm < 10 ||
      customHmm < 10);

  const canPrint = Boolean(printSlots.length > 0) && !customInvalid;

  const selectAllQtyInput = (el: HTMLInputElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => el.select());
  };

  if (ctxErr) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm font-black text-red-700">
        {ctxErr}
        <Link
          href={appHref("/other-operations")}
          className="mt-6 inline-block underline"
        >
          重新登入
        </Link>
      </div>
    );
  }

  if (!ctx) {
    return (
      <p className="py-24 text-center text-sm font-black text-purple-950">
        載入…
      </p>
    );
  }

  if (ctx.slug !== slugParam) {
    return (
      <p className="py-24 text-center text-sm font-black text-red-800">
        路徑與登入身分不符
      </p>
    );
  }

  return (
    <>
      <style id="label-print-page-def">{pageCss}</style>

      <main className="mx-auto min-h-[100dvh] max-w-2xl bg-[#FAFCFC] px-4 pb-24 pt-[max(0.75rem,env(safe-area-inset-top))] print:hidden">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-sm font-bold text-purple-800 underline"
        >
          ← 返回前一頁
        </button>
        <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50/80 px-4 py-3">
          <p className="text-[11px] font-black tracking-wide text-purple-700">
            單位名稱
          </p>
          <p className="mt-1 text-2xl font-black leading-tight text-purple-950">
            {(ctx.name ?? "").trim() || ctx.slug}
          </p>
        </div>
        <h1 className="mt-5 text-xl font-black text-purple-950">
          QR 標籤產製
        </h1>

        {ctx.label_template_id ? (
          <p className="mt-2 rounded-lg bg-violet-100/80 px-3 py-2 text-xs font-bold text-violet-950">
            已套用後台標籤範本（欄位順序）：{excelColumnHint}
          </p>
        ) : (
          <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            預設欄位順序（未綁範本）：{excelColumnHint}
          </p>
        )}

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-base font-black text-slate-900">
              單筆即時輸入
            </h2>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setMaterialTab("raw")}
                className={`rounded-lg px-4 py-2 text-sm font-black transition-colors ${
                  materialTab === "raw"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200"
                }`}
              >
                原物料
              </button>
              <button
                type="button"
                onClick={() => setMaterialTab("special")}
                className={`rounded-lg px-4 py-2 text-sm font-black transition-colors ${
                  materialTab === "special"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200"
                }`}
              >
                特殊
              </button>
            </div>

            <label
              className="mt-4 block text-[1.3rem] font-black text-zinc-900"
              htmlFor="unit-label-item-no"
            >
              料號（ENTER 下一步）
            </label>
            <input
              id="unit-label-item-no"
              className="mt-2 w-full rounded-xl border border-zinc-300 p-3 text-base font-bold"
              placeholder="請輸入…"
              value={itemNo}
              onChange={(e) => {
                setItemNo(e.target.value);
                clearExcelBatch();
              }}
              onBlur={() => void lookupMaterial()}
              onKeyDown={onItemNoKeyDown}
              disabled={busy || excelLocked}
              autoComplete="off"
            />

            <div className="mt-4 rounded-xl border border-dashed border-zinc-400 bg-zinc-50/80 p-4">
              <label
                className="block text-[1.3rem] font-black text-zinc-900"
                htmlFor="unit-label-item-name"
              >
                品名
              </label>
              <input
                id="unit-label-item-name"
                className="mt-2 w-full border-0 bg-transparent text-base font-bold text-zinc-800 outline-none placeholder:text-zinc-400"
                placeholder="---"
                value={itemName}
                onChange={(e) => {
                  setItemName(e.target.value);
                  clearExcelBatch();
                }}
                readOnly={matchedFromMaster}
                disabled={busy || excelLocked}
              />
              <label
                className="mt-3 block text-[1.3rem] font-black text-zinc-900"
                htmlFor="unit-label-spec"
              >
                規格
              </label>
              <input
                id="unit-label-spec"
                className="mt-2 w-full border-0 bg-transparent text-base font-bold text-zinc-800 outline-none placeholder:text-zinc-400"
                placeholder="---"
                value={spec}
                onChange={(e) => {
                  setSpec(e.target.value);
                  clearExcelBatch();
                }}
                readOnly={matchedFromMaster}
                disabled={busy || excelLocked}
              />
            </div>

            <label
              className="mt-4 block text-[1.3rem] font-black text-zinc-900"
              htmlFor="unit-label-print-size"
            >
              標籤常用尺寸選擇
            </label>
            <select
              id="unit-label-print-size"
              className="mt-2 w-full rounded-xl border border-zinc-300 p-3 font-bold"
              value={printSize}
              onChange={(e) => {
                const v = e.target.value as PrintFmt;
                setPrintSize(v);
                if (v === "custom") {
                  setCustomWmm(50);
                  setCustomHmm(30);
                }
              }}
              disabled={busy}
            >
              <option value="a4">A4 紙張</option>
              <option value="label-30x20">物料小標（30×20 mm）</option>
              <option value="label-50x30">物料小標（50×30 mm）</option>
              <option value="label-80x45">標籤貼紙 80×45 mm</option>
              <option value="label-40x40">標籤貼紙 40×40 mm</option>
              <option value="label-100x150">
                標籤貼紙 100×150 mm（貨運單）
              </option>
              <option value="custom">自訂尺寸（mm）</option>
            </select>

            {printSize === "custom" ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-zinc-600">
                    寬度（mm）
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    className="mt-1 w-full rounded-xl border border-zinc-300 p-2.5 font-bold"
                    value={customWmm}
                    onChange={(e) =>
                      setCustomWmm(Number(e.target.value))
                    }
                    disabled={busy}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-600">
                    高度（mm）
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    className="mt-1 w-full rounded-xl border border-zinc-300 p-2.5 font-bold"
                    value={customHmm}
                    onChange={(e) =>
                      setCustomHmm(Number(e.target.value))
                    }
                    disabled={busy}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-stretch gap-3">
              <button
                type="button"
                disabled={busy || !canPrint}
                onClick={() => void saveThenPrint()}
                className="min-h-[3.25rem] flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-lg font-black text-white shadow-lg disabled:opacity-40"
              >
                {busy ? "存檔並開啟列印…" : "列印"}
              </button>
              <div className="flex w-[5.5rem] shrink-0 flex-col justify-center rounded-xl border border-zinc-300 bg-white px-2 py-2">
                <label
                  className="text-center text-[1.3rem] font-black leading-none text-zinc-900"
                  htmlFor="unit-label-print-qty"
                >
                  張數
                </label>
                <input
                  id="unit-label-print-qty"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="mt-1 w-full border-0 bg-transparent p-0 text-center text-lg font-black text-blue-700 outline-none disabled:text-zinc-400"
                  placeholder="1"
                  value={printCopiesStr}
                  onChange={(e) => {
                    setPrintCopiesStr(e.target.value);
                    clearExcelBatch();
                  }}
                  onFocus={(e) => selectAllQtyInput(e.target)}
                  onClick={(e) => selectAllQtyInput(e.currentTarget)}
                  disabled={busy || excelLocked}
                  autoComplete="off"
                  title={
                    excelLocked
                      ? `Excel 批次下列印張數由試算表第 ${printCountOrdinal} 欄（列印張數）決定`
                      : "相同內容要印幾張標籤"
                  }
                  aria-label="張數"
                />
              </div>
            </div>

            {btDeviceLabel ? (
              <p className="mt-3 text-xs font-bold text-emerald-800">
                藍牙：{btDeviceLabel}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            {excelBatchEnabled ? (
              <div>
                <h2 className="text-base font-black text-slate-900">
                  整批清單列印（Excel 上傳）
                </h2>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="sr-only"
                  onChange={onExcelSelected}
                  disabled={busy}
                  aria-hidden
                />
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      excelInputRef.current?.click();
                    }
                  }}
                  onClick={() => excelInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={onExcelDrop}
                  className="mt-3 cursor-pointer rounded-2xl border-2 border-dashed border-purple-300 bg-white p-6 text-center shadow-sm"
                >
                  <p className="text-sm font-black text-purple-950">
                    點擊或拖放 Excel 至此
                  </p>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    EXCEL UPLOAD AREA
                  </p>
                </div>
                {excelFileStatus ? (
                  <p className="mt-2 text-sm font-bold text-emerald-800">
                    {excelFileStatus}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] font-semibold text-zinc-500">
                  {excelColumnHint}（可含標題列）；下方顯示品項數與總張數。「列印張數」為{' '}
                  <span className="font-mono">print_count</span> 欄。
                </p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-purple-900">
                Live preview
              </p>
              {excelBatch ? (
                <p className="mt-2 rounded-lg bg-purple-50 px-3 py-2 text-center text-sm font-black leading-snug text-purple-950">
                  已讀取 {excelTotalItems} 個品項，共將產出 {excelTotalSheets}{" "}
                  張標籤
                </p>
              ) : null}
              <div className="mt-3 flex flex-col items-center gap-2">
                {previewQrPayload ? (
                  <QRCodeSVG
                    value={previewQrPayload}
                    size={previewQrSize}
                    level="M"
                  />
                ) : (
                  <p className="py-12 text-xs text-zinc-400">請輸入內容</p>
                )}
                {printSize === "label-50x30" ? (
                  <p className="text-[11px] font-bold text-zinc-500">
                    50mm × 30mm
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            title="選取／配對標籤機（Web Bluetooth）"
            onClick={() => void requestBluetoothPrinter()}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-purple-600 bg-white text-purple-800 shadow-md active:scale-95 disabled:opacity-40"
            disabled={busy}
            aria-label="藍牙配對標籤機"
          >
            <Bluetooth className="h-8 w-8" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {msg ? (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-center text-sm font-bold text-amber-950">
            {msg}
          </p>
        ) : null}
      </main>

      <div className="hidden print:block print:bg-white" aria-hidden>
        {printSlots.map((slotPayload, idx) => (
          <div
            key={`${idx}-${slotPayload.slice(0, 24)}`}
            className="flex min-h-[100vh] w-full flex-col items-center justify-center gap-[1.5mm] print:max-w-[98%] print:p-[env(safe-area-inset)]"
            style={{
              pageBreakAfter:
                idx < printSlots.length - 1 ? "always" : "auto",
            }}
          >
            <QRCodeSVG
              value={slotPayload}
              size={printQrSizeAdjusted}
              level="M"
            />
          </div>
        ))}
      </div>
    </>
  );
}
