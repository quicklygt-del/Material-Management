import type { SupabaseClient } from "@supabase/supabase-js";
import { orderGroupKey } from "@/lib/pickingAgg";

export type WarehouseOpType = "inbound" | "outbound" | "stocktake";

export type WarehouseTaskGroup = {
  groupKey: string;
  order_no: string;
  types: WarehouseOpType[];
  required_qty: number;
  picked_qty: number;
  progress_pct: number;
  representativeTaskId: string;
};

export function normalizePickingOpType(raw: unknown): WarehouseOpType {
  const s = String(raw ?? "").trim();
  if (s === "inbound" || s === "stocktake") return s;
  return "outbound";
}

export function opTypeShortLabel(op: WarehouseOpType): string {
  if (op === "inbound") return "入庫";
  if (op === "stocktake") return "盤點";
  return "檢貨";
}

export async function fetchTodayTasksGrouped(
  supabase: SupabaseClient,
  assignedOperator: string,
  tenantSlug: string,
): Promise<WarehouseTaskGroup[]> {
  const name = assignedOperator.trim();
  if (!name) return [];

  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
  ).toISOString();
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
  ).toISOString();

  const tz = tenantSlug.trim();
  const { data: tasks, error: tErr } = await supabase
    .from("picking_tasks")
    .select(
      "id,order_no,item_no,required_qty,operation_type,status,picking_logs(actual_qty)",
    )
    .eq("tenant_id", tz)
    .eq("assigned_operator", name)
    .gte("created_at", start)
    .lt("created_at", end)
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false });

  if (tErr) {
    throw new Error(tErr.message);
  }

  type Agg = {
    groupKey: string;
    order_no: string;
    typeSet: Set<WarehouseOpType>;
    required_qty: number;
    picked_qty: number;
    representativeTaskId: string;
  };

  const byOrder = new Map<string, Agg>();
  for (const t of tasks ?? []) {
    const orderRaw = String(t.order_no ?? "");
    const groupKey = orderGroupKey(orderRaw);
    const req = Number(t.required_qty ?? 0);
    const pickingLogs = Array.isArray(
      (t as { picking_logs?: unknown[] }).picking_logs,
    )
      ? ((t as { picking_logs?: Array<{ actual_qty?: number | null }> })
          .picking_logs ?? [])
      : [];
    const pickedRow = pickingLogs.reduce(
      (s, lg) => s + (Number(lg.actual_qty) || 0),
      0,
    );
    const rowOp = normalizePickingOpType(t.operation_type);
    const tid = String(t.id);
    const cur =
      byOrder.get(groupKey) ??
      ({
        groupKey,
        order_no: orderRaw.trim(),
        typeSet: new Set<WarehouseOpType>(),
        required_qty: 0,
        picked_qty: 0,
        representativeTaskId: tid,
      } satisfies Agg);
    cur.required_qty += req;
    cur.picked_qty += pickedRow;
    cur.typeSet.add(rowOp);
    byOrder.set(groupKey, cur);
  }

  const mapped: WarehouseTaskGroup[] = Array.from(byOrder.values()).map(
    (g) => {
      const types = Array.from(g.typeSet);
      types.sort((a, b) =>
        opTypeShortLabel(a).localeCompare(opTypeShortLabel(b)),
      );
      const pct =
        g.required_qty > 0
          ? Math.min(100, Math.round((g.picked_qty / g.required_qty) * 100))
          : 0;
      return {
        groupKey: g.groupKey,
        order_no: g.order_no,
        types,
        required_qty: g.required_qty,
        picked_qty: g.picked_qty,
        progress_pct: pct,
        representativeTaskId: g.representativeTaskId,
      };
    },
  );
  mapped.sort((a, b) => a.order_no.localeCompare(b.order_no));
  return mapped;
}
