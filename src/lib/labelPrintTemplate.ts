import * as XLSX from "xlsx";

/** 後台可選的語意欄位鍵（與 Excel 欄順序對應） */
export const LABEL_TEMPLATE_KEY_PRESETS = [
  { key: "item_no", label_zh: "料號" },
  { key: "item_name", label_zh: "品名" },
  { key: "spec", label_zh: "規格" },
  { key: "batch_no", label_zh: "批號" },
  { key: "supplier_code", label_zh: "供應商代碼" },
  { key: "remark", label_zh: "備註" },
  { key: "print_count", label_zh: "列印張數" },
] as const;

export type LabelTemplateKey = (typeof LABEL_TEMPLATE_KEY_PRESETS)[number]["key"];

export type LabelTemplateField = {
  key: string;
  label_zh?: string;
};

const PRINT_COUNT_CAP = 9999;

export type ExcelLabelBatchItem = {
  qrText: string;
  printCount: number;
};

function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

export function presetLabelForKey(key: string): string {
  const p = LABEL_TEMPLATE_KEY_PRESETS.find((x) => x.key === key);
  return p?.label_zh ?? key;
}

export function normalizeLabelTemplateFields(raw: unknown): LabelTemplateField[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: LabelTemplateField[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const o = row as Record<string, unknown>;
    const key = String(o.key ?? "").trim();
    if (!key) return null;
    const lz = o.label_zh != null ? String(o.label_zh).trim() : "";
    out.push({
      key,
      ...(lz ? { label_zh: lz.slice(0, 32) } : {}),
    });
  }
  const printIdx = out.filter((x) => x.key === "print_count");
  if (printIdx.length !== 1) return null;
  const keySet = new Set<string>();
  for (const f of out) {
    if (keySet.has(f.key)) return null;
    keySet.add(f.key);
  }
  const allowed = new Set(LABEL_TEMPLATE_KEY_PRESETS.map((x) => x.key));
  for (const f of out) {
    if (!allowed.has(f.key as LabelTemplateKey)) return null;
  }
  if (out.length > 12) return null;
  return out;
}

export function getDefaultLabelTemplateFields(): LabelTemplateField[] {
  return [
    { key: "item_no", label_zh: "料號" },
    { key: "item_name", label_zh: "品名" },
    { key: "spec", label_zh: "規格" },
    { key: "print_count", label_zh: "列印張數" },
  ];
}

function parsePrintCountCell(raw: unknown): number {
  const s = cellToStr(raw);
  if (!s) return 1;
  const n = Number(String(s).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(PRINT_COUNT_CAP, Math.floor(n));
}

function rowLooksLikeHeader(
  cells: string[],
  fields: LabelTemplateField[],
): boolean {
  const joined = cells.join(" ").toLowerCase();
  const hasGeneric = /料號|品名|規格|列印|張數|數量|part|spec|qty|print|batch|批號/i.test(
    joined,
  );
  if (!hasGeneric) return false;
  const labels = fields
    .map((f) => (f.label_zh || presetLabelForKey(f.key)).toLowerCase())
    .filter(Boolean);
  let hits = 0;
  for (const lbl of labels) {
    if (lbl && cells.some((c) => c.toLowerCase().includes(lbl))) hits += 1;
  }
  return hits >= 1;
}

export function humanDescribeTemplateColumns(fields: LabelTemplateField[]): string {
  return fields
    .map((f, i) => `第 ${i + 1} 欄=${f.label_zh || presetLabelForKey(f.key)}`)
    .join("，");
}

/**
 * 依範本欄位順序解析 Excel（與現場標籤產製一致）。
 */
export function parseExcelLabelBatchWithTemplate(
  ab: ArrayBuffer,
  fieldsIn: LabelTemplateField[],
): ExcelLabelBatchItem[] {
  const fields = normalizeLabelTemplateFields(fieldsIn) ?? fieldsIn;
  if (!fields.length) throw new Error("範本欄位無效");

  const printIdx = fields.findIndex((f) => f.key === "print_count");
  if (printIdx < 0) throw new Error("範本必須包含「列印張數」欄位");

  const dataFieldIndices = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.key !== "print_count")
    .map(({ i }) => i);

  const wb = XLSX.read(ab, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("工作表為空");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  let startRow = 0;
  if (rows.length > 0) {
    const r0 = (rows[0] ?? []).map(cellToStr);
    if (rowLooksLikeHeader(r0, fields) && rows.length > 1) {
      startRow = 1;
    }
  }

  const items: ExcelLabelBatchItem[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const r = (rows[i] ?? []).map(cellToStr);
    const parts = dataFieldIndices.map((ci) => r[ci] ?? "");
    if (parts.every((p) => !p.trim())) continue;
    const printCount = parsePrintCountCell(r[printIdx]);
    if (printCount <= 0) continue;
    const qrText = parts.join("\n");
    items.push({ qrText, printCount });
  }

  if (items.length === 0) {
    throw new Error(
      `找不到有效資料（${humanDescribeTemplateColumns(fields)}；列印張數須為正整數）`,
    );
  }
  return items;
}

/** label-records 主檔料號：優先 template 中之 item_no 欄，否則取 QR 第一行 */
export function deriveItemNoForRecord(
  qrPayload: string,
  fields: LabelTemplateField[],
): string {
  const lines = qrPayload.split("\n");
  const itemIdx = fields.findIndex((f) => f.key === "item_no");
  if (itemIdx >= 0 && itemIdx < lines.length) {
    const v = lines[itemIdx]?.trim();
    if (v) return v.slice(0, 500);
  }
  const first = lines[0]?.trim();
  if (first) return first.slice(0, 500);
  return qrPayload.trim().slice(0, 500) || "-";
}
