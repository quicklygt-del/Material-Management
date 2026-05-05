import type { SupabaseClient } from "@supabase/supabase-js";

import { isPickingLogCountedAsPick } from "@/lib/pickingLogRules";

export function normPairPart(s: unknown): string {
  return String(s ?? "").replace(/\uFEFF/g, "").trim();
}

/** 單號統一鍵：NFKC + trim + 縮 whitespace（避免視覺重複／全形空格等造成後台／手機分列） */
export function orderGroupKey(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\uFEFF/g, "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function pairKey(order_no: unknown, item_no: unknown): string {
  return `${orderGroupKey(order_no)}\x1f${normPairPart(item_no)}`;
}

export type TaskLike = {
  id: string;
  order_no: string;
  item_no: string;
};

/** `.in(order_no)` 單次上限保守值（展開大小寫變體後仍不宜過大） */
const ORDER_IN_CHUNK = 96;

/** 撿貨紀錄的 order_no 若與任務只差大小寫／空白規範化，仍可撈到同一批 logs */
function pickingLogOrderQueryVariants(distinctOrders: string[]): string[] {
  const seen = new Set<string>();
  for (const o of distinctOrders) {
    const t = String(o ?? "").trim();
    if (!t) continue;
    seen.add(t);
    seen.add(orderGroupKey(t));
    seen.add(t.toUpperCase());
    seen.add(t.toLowerCase());
  }
  return Array.from(seen).filter(Boolean);
}

/** 依單號清單只載入可能相關的 picking_logs，避免全表掃描。鍵為 pairKey。 */
export async function aggregatePickingLogQtyByOrders(
  supabase: SupabaseClient,
  distinctOrderStrings: string[],
  tenantSlug?: string,
): Promise<Map<string, number>> {
  const qtyByPair = new Map<string, number>();
  const uniq = Array.from(
    new Set(distinctOrderStrings.map((o) => String(o ?? "").trim()).filter(Boolean)),
  );
  const expandedForQuery = pickingLogOrderQueryVariants(uniq);
  if (!expandedForQuery.length) return qtyByPair;

  for (let i = 0; i < expandedForQuery.length; i += ORDER_IN_CHUNK) {
    const slice = expandedForQuery.slice(i, i + ORDER_IN_CHUNK);
    let q = supabase
      .from("picking_logs")
      .select("order_no,item_no,actual_qty")
      .in("order_no", slice);
    if (tenantSlug) {
      q = q.eq("tenant_id", tenantSlug);
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const lg of data ?? []) {
      if (!isPickingLogCountedAsPick(lg)) continue;
      const pk = pairKey(lg.order_no, lg.item_no);
      qtyByPair.set(
        pk,
        (qtyByPair.get(pk) ?? 0) + (Number(lg.actual_qty) || 0),
      );
    }
  }
  return qtyByPair;
}

/** matched 紀錄的 actual_qty：以 order_no+item_no 對應 picking_tasks（首批任務 id 繼承德行與先前一致）。 */
export async function sumMatchedActualQtyByTask(
  supabase: SupabaseClient,
  tasks: TaskLike[],
  tenantSlug?: string,
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  for (const t of tasks) sums.set(t.id, 0);
  if (!tasks.length) return sums;

  const firstIdForPair = new Map<string, string>();
  for (const t of tasks) {
    const pk = pairKey(t.order_no, t.item_no);
    if (!firstIdForPair.has(pk)) firstIdForPair.set(pk, t.id);
  }

  const orders = Array.from(
    new Set(tasks.map((t) => String(t.order_no ?? "").trim()).filter(Boolean)),
  );
  const qtyByPair = await aggregatePickingLogQtyByOrders(
    supabase,
    orders,
    tenantSlug,
  );

  qtyByPair.forEach((qtyTotal, pk) => {
    const id = firstIdForPair.get(pk);
    if (id !== undefined) {
      sums.set(id, qtyTotal);
    }
  });

  return sums;
}

