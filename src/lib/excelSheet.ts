import * as XLSX from "xlsx";

export type ParsedSheet = {
  /** 第一列標題或 COL_0… */
  columnLabels: string[];
  dataRows: string[][];
};

function cellToStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

export async function parseExcelFirstSheet(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const name = wb.SheetNames[0];
  if (!name) return { columnLabels: [], dataRows: [] };
  const sheet = wb.Sheets[name];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (!aoa.length) return { columnLabels: [], dataRows: [] };

  const row0 = (aoa[0] ?? []).map((c) => cellToStr(c));
  const hasHeader = row0.some((c) => c !== "");

  if (!hasHeader) {
    const dataRows = aoa
      .map((r) => (r ?? []).map((c) => cellToStr(c)))
      .filter((r) => r.some((x) => x !== ""));
    const maxCols = Math.max(0, ...dataRows.map((r) => r.length));
    const columnLabels = Array.from({ length: maxCols }, (_, i) => `COL_${i}`);
    return { columnLabels, dataRows };
  }

  const columnLabels = row0.map((h, i) => (h ? h : `COL_${i}`));
  const maxW = Math.max(
    columnLabels.length,
    ...aoa.slice(1).map((r) => (r ?? []).length),
  );
  while (columnLabels.length < maxW)
    columnLabels.push(`COL_${columnLabels.length}`);

  const dataRows: string[][] = [];
  for (let ri = 1; ri < aoa.length; ri += 1) {
    const row = (aoa[ri] ?? []).map((c) => cellToStr(c));
    while (row.length < columnLabels.length) row.push("");
    if (row.some((x) => x !== "")) dataRows.push(row);
  }

  return { columnLabels, dataRows };
}

/** 規格字面：trim → toUpperCase → 移除冒號與（Unicode）空白 */
export function nfcUidFuzzyFormatSpec(rawInput: unknown): string {
  const s = String(rawInput ?? "").replace(/\uFEFF/g, "").trim();
  return s.toUpperCase().replace(/[:\s]/g, "");
}

/** 裸網址且無 uid／nfc_uid 參數時回 null（比對不可用）；否則回用於格式化與 hex 鍵來源字串。 */
function resolveUidSegmentPreferQueryParam(
  trimmedFull: string,
): string | null {
  const fromParam =
    /\b(?:uid|nfc_uid|nfcUid)=([^&#\s]+)/i.exec(trimmedFull)?.[1] ?? "";
  if (fromParam) {
    try {
      return decodeURIComponent(fromParam.trim());
    } catch {
      return fromParam.trim();
    }
  }
  if (/^https?:\/\//i.test(trimmedFull)) return null;
  return trimmedFull;
}

/**
 * 「寬容格式」錯誤訊息用：原始字串摘要 → toUpperCase+去冒號空白（對有效片段或整段貼入）。
 */
export function nfcUidExplainDetectFormat(
  rawInput: unknown,
  maxOriginal = 220,
): string {
  const rawFull = String(rawInput ?? "").replace(/\uFEFF/g, "").trim();
  const origShow = rawFull ? rawFull.slice(0, maxOriginal) : "(空)";
  const resolved = resolveUidSegmentPreferQueryParam(rawFull);
  const forFmt = resolved ?? rawFull;
  const formatted = nfcUidFuzzyFormatSpec(forFmt);
  return `偵測到的格式：${origShow} -> 系統轉換後：${formatted || "(套用規則後為空)"}`;
}

/**
 * 連續十六進位比對鍵（歷史上用於標籤 UID；可作為通用字串規範）。
 * 使「04:A1:B2／04-a1-b2／04a1b2」對到同一 UID；URL 僅認 uid=／nfc_uid=／nfcUid=。
 */
export function nfcUidMatchKey(rawInput: unknown): string {
  const trimmed = String(rawInput ?? "").replace(/\uFEFF/g, "").trim();
  if (!trimmed) return "";
  const segment = resolveUidSegmentPreferQueryParam(trimmed);
  if (segment === null) return "";
  const fuzzyLayer = nfcUidFuzzyFormatSpec(segment);
  const token = fuzzyLayer.replace(/-/g, "").replace(/[^0-9A-F]/g, "").toUpperCase();
  if (
    token.length < 6 ||
    token.length > 28 ||
    !/^[0-9A-F]+$/.test(token)
  ) {
    return "";
  }
  return token;
}

/** 連續大寫十六進位比對鍵（連續大寫 hex） */
export function normalizeNfcUid(s: string): string {
  return nfcUidMatchKey(s);
}
