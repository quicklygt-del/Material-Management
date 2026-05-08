import type { SupabaseClient } from "@supabase/supabase-js";

/** 指揮塔當前任務看板單筆（與 admin/page 狀態一致） */
export type CommandTowerTask = {
  id: number | string;
  orderNo: string;
  items: Array<{
    partNo?: string;
    qty?: number | string;
    itemName?: string;
    spec?: string;
    unit?: string;
  }>;
  assignedTo: string;
  status: string;
  type: string;
  createdAt?: string;
};

function mapUiTypeToOperation(type: string): "inbound" | "outbound" | "stocktake" {
  const t = String(type ?? "").trim();
  if (t === "入庫") return "inbound";
  if (t === "盤單" || t === "盤點") return "stocktake";
  return "outbound";
}

function mapOperationToTaskType(
  op: "inbound" | "outbound" | "stocktake",
): string {
  if (op === "inbound") return "入庫";
  if (op === "stocktake") return "盤點";
  return "領料";
}

function mapUiStatusToPicking(
  status: string,
): "pending" | "in_progress" | "completed" | null {
  const s = String(status ?? "").trim();
  if (s === "未進行") return "pending";
  if (s === "進行中") return "in_progress";
  if (s === "完成") return "completed";
  return null;
}

export async function deletePickingTasksForOrder(
  supabase: SupabaseClient,
  _tenantSlug: string,
  orderNo: string,
): Promise<void> {
  const order = String(orderNo ?? "").trim();
  if (!order) return;
  const q = supabase.from("picking_tasks").delete().eq("order_no", order);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * 將指揮塔任務寫入 picking_tasks，供倉管員工作台（WarehouseStyleTaskDeck）讀取。
 * 未派單或無執行人員：刪除該單號於 DB 之明細（避免舊派單残留）。
 */
export async function syncCommandTowerTasksToSupabase(
  supabase: SupabaseClient,
  _tenantSlug: string,
  tasks: CommandTowerTask[],
): Promise<void> {
  for (const task of tasks) {
    const orderNo = String(task.orderNo ?? "").trim();
    if (!orderNo) continue;

    const assigned = String(task.assignedTo ?? "").trim();
    const unassigned =
      String(task.status ?? "").trim() === "未派單" || !assigned;

    if (unassigned) {
      await deletePickingTasksForOrder(supabase, "", orderNo);
      continue;
    }

    const opType = mapUiTypeToOperation(task.type);
    let pickingStatus = mapUiStatusToPicking(task.status);
    if (!pickingStatus) {
      pickingStatus = "pending";
    }

    const rows: Record<string, unknown>[] = [];
    for (const item of task.items ?? []) {
      const itemCode = String(item.partNo ?? "").trim();
      if (!itemCode) continue;
      const qtyRaw = Number(item.qty ?? 0);
      const target_qty =
        Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 0;
      if (target_qty <= 0) continue;

      const nm = String(item.itemName ?? "").trim();
      const sp = String(item.spec ?? "").trim();
      const un = String(item.unit ?? "").trim();

      const row: Record<string, unknown> = {
        order_no: orderNo,
        item_code: itemCode,
        item_name: nm || "",
        spec: sp || "",
        unit: un || "",
        target_qty,
        operation_type: opType,
        task_type: mapOperationToTaskType(opType),
        picked_qty: 0,
        status: pickingStatus,
        assigned_operator: assigned,
      };
      rows.push(row);
    }

    await deletePickingTasksForOrder(supabase, "", orderNo);

    if (rows.length === 0) continue;

    const { error: insErr } = await supabase.from("picking_tasks").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }
}
