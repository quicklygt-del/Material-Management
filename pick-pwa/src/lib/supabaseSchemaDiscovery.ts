import type { SupabaseClient } from "@supabase/supabase-js";

/** 從 Supabase URL 解析專案 ref（例：https://abcd.supabase.co → abcd） */
export function extractSupabaseProjectRef(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const m = /^([a-z0-9]+)\.supabase\.co$/i.exec(u.hostname);
    return m ? m[1] ?? null : null;
  } catch {
    return null;
  }
}

export function maskSecret(s: string, headChars = 8): string {
  const t = s.trim();
  if (!t) return "(empty)";
  if (t.length <= headChars) return "***";
  return `${t.slice(0, headChars)}… (length ${t.length})`;
}

/** service_role JWT 通常遠大於此；過短代表未設定或誤植 */
export function isPlausibleServiceRoleKey(): boolean {
  const k =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    "";
  return k.trim().length >= 80;
}

export type TableColumnsResult = {
  table: string;
  columns: string[] | null;
  source: "rpc" | "sample_row" | "unavailable";
  detail?: string;
};

/**
 * 欄位探索：優先 RPC（information_schema），否則取樣首列。
 * 若表為空且無 RPC，columns 為 null。
 */
export async function fetchPublicTableColumns(
  admin: SupabaseClient,
  tableName: string,
): Promise<TableColumnsResult> {
  const rpc = await admin.rpc("debug_table_columns", {
    p_table: tableName,
  });
  if (!rpc.error && rpc.data != null) {
    const rows = rpc.data as unknown;
    const names: string[] = [];
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (r && typeof r === "object" && "column_name" in r) {
          names.push(String((r as { column_name: unknown }).column_name));
        } else if (typeof r === "string") {
          names.push(r);
        }
      }
    }
    if (names.length > 0) {
      return { table: tableName, columns: names, source: "rpc" };
    }
  }

  const sample = await admin.from(tableName).select("*").limit(1);
  if (sample.error) {
    const msg = sample.error.message;
    if (/does not exist|schema cache|relation|Could not find/i.test(msg)) {
      return {
        table: tableName,
        columns: null,
        source: "unavailable",
        detail: msg,
      };
    }
    return {
      table: tableName,
      columns: null,
      source: "unavailable",
      detail: msg,
    };
  }

  const row = sample.data?.[0];
  if (row && typeof row === "object" && !Array.isArray(row)) {
    return {
      table: tableName,
      columns: Object.keys(row as Record<string, unknown>),
      source: "sample_row",
    };
  }

  return {
    table: tableName,
    columns: null,
    source: "unavailable",
    detail:
      "無法取得欄位：表可能為空且未部署 debug_table_columns RPC；請在 SQL Editor 執行 supabase/patch_debug_table_columns_rpc.sql",
  };
}

/** 由已知欄位組出 PostgREST select 字串（僅含存在的欄） */
export function selectExistingColumns(
  available: Set<string>,
  candidates: string[],
): string {
  return candidates.filter((c) => available.has(c)).join(",");
}

export function pickNumericQtyColumn(cols: Set<string>): string | null {
  if (cols.has("stock_quantity")) return "stock_quantity";
  if (cols.has("on_hand")) return "on_hand";
  return null;
}

export function pickItemMatchColumns(cols: Set<string>): string[] {
  const keys = ["item_code", "item_no"].filter((k) => cols.has(k));
  return keys.length > 0 ? keys : [];
}

export function pickScopeColumns(cols: Set<string>): ("" | "company_id")[] {
  const out: ("" | "company_id")[] = [];
  if (cols.has("")) out.push("");
  if (cols.has("company_id")) out.push("company_id");
  return out;
}
