import type { SupabaseClient } from "@supabase/supabase-js";

/** 未指定儲位時之預設儲位代碼（僅系統內部，不寫入 QR） */
export const LEDGER_DEFAULT_BIN = "__DEFAULT__";

export function normLedgerBinCode(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/\uFEFF/g, "")
    .trim()
    .slice(0, 64);
  return s || LEDGER_DEFAULT_BIN;
}

export async function binStockTableReady(
  admin: SupabaseClient,
): Promise<boolean> {
  const { error } = await admin.from("warehouse_ledger_bin_stock").select("id").limit(1);
  if (!error) return true;
  return !/does not exist|42P01|relation/i.test(String(error.message ?? ""));
}

async function readBinQty(
  admin: SupabaseClient,
  itemNo: string,
  binCode: string,
): Promise<number> {
  const { data, error } = await admin
    .from("warehouse_ledger_bin_stock")
    .select("qty")
    .eq("item_no", itemNo)
    .eq("bin_code", binCode)
    .maybeSingle();
  if (error || !data) return 0;
  return Number((data as { qty?: number }).qty) || 0;
}

export async function applyBinDelta(
  admin: SupabaseClient,
  itemNo: string,
  binCode: string,
  delta: number,
): Promise<{ ok: true; qty_after: number } | { ok: false; error: string }> {
  const d = Math.trunc(delta);
  const cur = await readBinQty(admin, itemNo, binCode);
  const next = cur + d;
  const iso = new Date().toISOString();
  const { error } = await admin.from("warehouse_ledger_bin_stock").upsert(
    {
      item_no: itemNo,
      bin_code: binCode,
      qty: next,
      updated_at: iso,
    },
    { onConflict: "item_no,bin_code" },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, qty_after: next };
}

export async function setBinQtyExact(
  admin: SupabaseClient,
  itemNo: string,
  binCode: string,
  qty: number,
): Promise<{ ok: true; qty_after: number } | { ok: false; error: string }> {
  const q = Math.trunc(qty);
  const iso = new Date().toISOString();
  const { error } = await admin.from("warehouse_ledger_bin_stock").upsert(
    {
      item_no: itemNo,
      bin_code: binCode,
      qty: q,
      updated_at: iso,
    },
    { onConflict: "item_no,bin_code" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, qty_after: q };
}

/** 以各儲位加總回寫 warehouse_ledger_stock 總量 */
export async function reconcileLedgerTotalFromBins(
  admin: SupabaseClient,
  itemNo: string,
): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("warehouse_ledger_bin_stock")
    .select("qty")
    .eq("item_no", itemNo);
  if (error) {
    return { ok: false, error: error.message };
  }
  const total = (data ?? []).reduce(
    (s, r) => s + (Number((r as { qty?: number }).qty) || 0),
    0,
  );
  const iso = new Date().toISOString();
  let up = await admin
    .from("warehouse_ledger_stock")
    .update({ stock_quantity: total, updated_at: iso })
    .eq("item_no", itemNo);
  if (up.error && /column .*stock_quantity.* does not exist/i.test(up.error.message)) {
    up = await admin
      .from("warehouse_ledger_stock")
      .update({ on_hand: total, updated_at: iso })
      .eq("item_no", itemNo);
  }
  if (up.error) {
    return { ok: false, error: up.error.message };
  }
  return { ok: true, total };
}

export async function listBinsForItem(
  admin: SupabaseClient,
  itemNo: string,
): Promise<
  { ok: true; bins: { bin_code: string; qty: number; updated_at: string }[] } | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("warehouse_ledger_bin_stock")
    .select("bin_code,qty,updated_at")
    .eq("item_no", itemNo)
    .order("bin_code", { ascending: true });
  if (error) {
    return { ok: false, error: error.message };
  }
  const bins = (data ?? []).map((r) => {
    const row = r as { bin_code?: string; qty?: number; updated_at?: string };
    return {
      bin_code: String(row.bin_code ?? ""),
      qty: Number(row.qty) || 0,
      updated_at: String(row.updated_at ?? ""),
    };
  });
  return { ok: true, bins };
}
