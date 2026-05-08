/**
 * 手動維護的 Supabase 列型別（補齊 codegen 尚未同步的欄位）。
 * `warehouse_ledger_stock` 於 schema 見 `supabase/schema_warehouse_general_ledger.sql`。
 * 若 Vercel／tsc 報「on_hand 不存在」，請確認此 Row 含 `on_hand`。
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** 對應資料表 `public.warehouse_ledger_stock` */
export type WarehouseLedgerStockRow = {
  id: string;
  item_no: string;
  item_name: string;
  spec: string;
  /** 現有總量（舊版 DDL 欄位名） */
  on_hand: number;
  attrs: Json;
  created_at: string;
  updated_at: string;
  /** 部分環境改欄名為 stock_quantity，與 on_hand 擇一存在 */
  stock_quantity?: number | null;
};
