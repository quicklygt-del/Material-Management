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

const taskCache = new Map<
  string,
  { at: number; data: WarehouseTaskGroup[] }
>();
const TASK_CACHE_TTL_MS = 2500;

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
): Promise<WarehouseTaskGroup[]> {
  const name = assignedOperator.trim();
  if (!name) return [];
  const cacheKey = name;
  const hit = taskCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TASK_CACHE_TTL_MS) {
    return hit.data;
  }

  // 與指揮塔看板一致：依「指派對象＋未完成」列出，不要用 created_at 卡「今天」，
  // 否則跨日／時區／舊單會出現管理端有單、倉管端空白。
  const selFull =
    "id,order_no,item_no:item_no,required_qty:target_qty,picked_qty,operation_type,status";
  const selNoPicked =
    "id,order_no,item_no:item_no,required_qty:target_qty,operation_type,status";

  const tq = supabase
    .from("picking_tasks")
    .select(selFull)
    .eq("assigned_operator", name)
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(800);
  let tasks: unknown[] | null = null;
  let tErr = null as { message: string } | null;
  {
    const first = await tq;
    tasks = first.data as unknown[] | null;
    tErr = first.error;
  }
  if (
    tErr &&
    /picked_qty|column .* does not exist/i.test(String(tErr.message ?? ""))
  ) {
    const second = await supabase
      .from("picking_tasks")
      .select(selNoPicked)
      .eq("assigned_operator", name)
      .in("status", ["pending", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(800);
    tasks = second.data as unknown[] | null;
    tErr = second.error;
  }

  type RawTask = {
    id: string;
    order_no: string;
    item_no?: unknown;
    required_qty?: unknown;
    picked_qty?: number | null;
    operation_type?: unknown;
    status?: unknown;
  };
  if (tErr) {
    throw new Error(tErr.message);
  }

  const taskList = (tasks ?? []) as RawTask[];

  const taskIds = taskList.map((t) => String(t.id)).filter(Boolean);
  const pickedByTask = new Map<string, number>();
  if (taskIds.length > 0) {
    const lq = supabase
      .from("picking_logs")
      .select("task_id,actual_qty")
      .in("task_id", taskIds);
    const { data: logs, error: lErr } = await lq;
    if (lErr) throw new Error(lErr.message);
    for (const lg of logs ?? []) {
      const k = String((lg as { task_id?: string | null }).task_id ?? "");
      if (!k) continue;
      const v = Number((lg as { actual_qty?: number | null }).actual_qty) || 0;
      pickedByTask.set(k, (pickedByTask.get(k) ?? 0) + v);
    }
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
  for (const t of taskList) {
    const orderRaw = String(t.order_no ?? "");
    const groupKey = orderGroupKey(orderRaw);
    const req = Number(t.required_qty ?? 0);
    const fromLogs = pickedByTask.get(String(t.id)) ?? 0;
    const fromRow = Number((t as { picked_qty?: number | null }).picked_qty ?? 0) || 0;
    const pickedRow = Math.max(fromLogs, fromRow);
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
  taskCache.set(cacheKey, { at: Date.now(), data: mapped });
  return mapped;
}
