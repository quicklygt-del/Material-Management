/**
 * 倉儲總帳：欄位鍵別名（對應 Excel／ERP）。
 * 擴充時僅調整此對照或新增對應，不必更名資料表。
 */
/** 對外 JSON／API／attrs 語意鍵 — 對應 DB 直欄，便於換 ERP 欄名對照 */
export const LEDGER_SEMANTIC_KEYS = {
  itemNo: "item_no",
  itemName: "item_name",
  spec: "spec",
  onHand: "on_hand",
} as const;

export const IMPORT_HEADER_GROUPS = {
  item_no: ["item_no", "料號", "品號", "物料", "item no", "itemno", "part no", "料品編號"],
  item_name: ["item_name", "品名", "名稱", "品項", "物料名稱"],
  spec: ["spec", "規格", "规格", "型號", "型号", "size"],
  on_hand: [
    "on_hand",
    "現有總量",
    "现有总量",
    "庫存",
    "库存",
    "數量",
    "qty_on_hand",
    "quantity_on_hand",
  ],
} as const;

export type WarehouseLedgerDirection = "inbound" | "outbound";

export function normLedgerItemNo(raw: unknown): string {
  return String(raw ?? "").replace(/\uFEFF/g, "").trim();
}

export type WarehouseLedgerPostBody = {
  ?: string;
  item_no: string;
  direction: WarehouseLedgerDirection;
  qty: number;
  shortage_forced?: boolean;
  order_no?: string;
  task_id?: string;
  operator_name?: string;
  scan_payload?: string;
  seed_item_name?: string;
  seed_spec?: string;
};

/** 非同步調帳：不向掃描流程 await，以降低現場頓點 */
export function fireWarehouseLedgerPostMove(body: WarehouseLedgerPostBody): void {
  if (typeof window === "undefined") return;
  void fetch(`${window.location.origin}/api/warehouse-ledger/post-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
