/** 標籤 QR 編碼：[前綴]-[類型碼]-[流水序號] */

export type LabelTypeCode = "S" | "R" | "B" | "Q" | "D";

const TYPE_LABELS: Record<LabelTypeCode, string> = {
  S: "標準進料",
  R: "餘料／退料",
  B: "裝箱／集合",
  Q: "不良品／QC",
  D: "自定義資產",
};

export function labelTypeName(code: LabelTypeCode): string {
  return TYPE_LABELS[code];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 與 DB label_records.、QR 第一段一致；可由環境覆寫 */
export function getDefaultLabelPrefix(): string {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_LABEL_PREFIX ||
        process.env.NEXT_PUBLIC_)) ||
    "WMS";
  return normalizeLabelPrefix(String(raw));
}

export function normalizeLabelPrefix(raw: string): string {
  return raw
    .replace(/\uFEFF/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

/** @deprecated 使用 normalizeLabelPrefix */
export const normalizeTenantId = normalizeLabelPrefix;

/** 料號末 4 字元（不足則左側補零／符號） */
export function lastFourFromItemNo(itemNo: string): string {
  const t = itemNo.replace(/\uFEFF/g, "").trim();
  if (!t) return "0000";
  const slice = t.length >= 4 ? t.slice(-4) : t.padStart(4, "0");
  return slice.toUpperCase();
}

/**
 * 流水序號：YYMMDD + HHmm + 來源末 4 碼
 */
export function buildSerialSegment(source: string, at: Date = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2);
  const MM = pad2(at.getMonth() + 1);
  const dd = pad2(at.getDate());
  const HH = pad2(at.getHours());
  const mm = pad2(at.getMinutes());
  const tail = lastFourFromItemNo(source);
  return `${yy}${MM}${dd}${HH}${mm}${tail}`;
}

/** 非裝箱／研發：通常用料號；裝箱：料號／箱號／備註；研發：料號／專案+負責人 */
export function resolveSerialSource(
  typeCode: LabelTypeCode,
  params: {
    itemNo: string;
    bundleNo: string;
    contentNote: string;
    rndProject?: string;
    rndOwner?: string;
  },
): string {
  const item = params.itemNo.replace(/\uFEFF/g, "").trim();
  const bundle = params.bundleNo.replace(/\uFEFF/g, "").trim();
  const note = params.contentNote.replace(/\uFEFF/g, "").trim();
  if (typeCode === "B") {
    return item || bundle || note || "0000";
  }
  if (typeCode === "D") {
    const p = (params.rndProject ?? "").replace(/\uFEFF/g, "").trim();
    const o = (params.rndOwner ?? "").replace(/\uFEFF/g, "").trim();
    const note = (params.contentNote ?? "").replace(/\uFEFF/g, "").trim();
    return item || `${p}${o}${note}` || p || o || note || "";
  }
  if (!item) return "";
  return item;
}

/** 列印／紀錄用操作單位（非 QR 內容） */
export const LABEL_OPERATION_UNITS = ["收發", "品保", "包裝", "現場", "研發"] as const;
export type LabelOperationUnit = (typeof LABEL_OPERATION_UNITS)[number];

export function buildLabelQrPayload(params: {
  typeCode: LabelTypeCode;
  serialSource: string;
  at?: Date;
}): string {
  const prefix = getDefaultLabelPrefix();
  if (!prefix) {
    throw new Error("請設定公司識別前綴");
  }
  const src = params.serialSource.replace(/\uFEFF/g, "").trim();
  if (params.typeCode !== "B" && params.typeCode !== "D" && !src) {
    throw new Error("請輸入料號");
  }
  if (params.typeCode === "D" && !src) {
    throw new Error("需名稱或描述至少一項");
  }
  const serial = buildSerialSegment(src || "0000", params.at ?? new Date());
  return `${prefix}-${params.typeCode}-${serial}`;
}

/** 解析標籤 QR 字串（前三段） */
export function parseLabelQrPayload(raw: string): {
  prefix: string;
  typeCode: LabelTypeCode | null;
  serial: string;
} | null {
  const t = raw.replace(/\uFEFF/g, "").trim();
  const parts = t.split("-");
  if (parts.length < 3) return null;
  const prefix = parts[0] ?? "";
  const typeChar = (parts[1] ?? "").toUpperCase();
  const serial = parts.slice(2).join("-");
  const typeCode =
    typeChar === "S" || typeChar === "R" || typeChar === "B" || typeChar === "Q" || typeChar === "D"
      ? (typeChar as LabelTypeCode)
      : null;
  return { prefix, typeCode, serial };
}
