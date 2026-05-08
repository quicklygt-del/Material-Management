import type { SupabaseClient } from "@supabase/supabase-js";
import type { WarehouseLedgerDirection } from "@/lib/warehouseLedger";

export type LedgerMoveRef = Record<string, unknown>;

export type WarehouseLedgerMoveParams = {
  tenantId: string;
  itemNo: string;
  direction: WarehouseLedgerDirection;
  qty: number;
  shortageForced: boolean;
  ref: LedgerMoveRef;
  seedItemName?: string;
  seedSpec?: string;
};

function refText(ref: LedgerMoveRef, key: string): string {
  const v = ref[key];
  return v == null ? "" : String(v).trim();
}

function mapOperationToTaskType(op: string): string {
  if (op === "inbound") return "入庫";
  if (op === "stocktake") return "盤點";
  return "領料";
}

async function syncPickingProgressAfterLedgerMove(
  admin: SupabaseClient,
  p: WarehouseLedgerMoveParams,
  qty: number,
): Promise<void> {
  const taskId = refText(p.ref, "task_id");
  const orderNo = refText(p.ref, "order_no");
  const scanPayload = refText(p.ref, "scan_payload");
  const operatorName = refText(p.ref, "operator_name");

  const buildTaskQuery = (columns: string) => {
    let q = admin
      .from("picking_tasks")
      .select(columns)
      .eq("item_code", p.itemNo);
    if (orderNo) q = q.eq("order_no", orderNo);
    else if (taskId) q = q.eq("id", taskId);
    else return null;
    return q.limit(1);
  };

  let supportsPickedQty = true;
  let taskQuery = buildTaskQuery(
    "id,order_no,item_code,target_qty,status,started_at,operation_type,picked_qty",
  );
  if (!taskQuery) return;

  let taskPick = await taskQuery.maybeSingle();
  let taskRow = taskPick.data;
  let taskErr = taskPick.error;
  if (
    taskErr &&
    /column .*picked_qty.* does not exist|column .*task_type.* does not exist/i.test(
      taskErr.message,
    )
  ) {
    supportsPickedQty = false;
    taskQuery = buildTaskQuery(
      "id,order_no,item_code,target_qty,status,started_at,operation_type",
    );
    if (!taskQuery) return;
    const legacyPick = await taskQuery.maybeSingle();
    taskRow = legacyPick.data;
    taskErr = legacyPick.error;
  }
  if (taskErr || !taskRow) return;
  const tr = taskRow as unknown as {
    id: string;
    order_no: string;
    item_code?: string;
    target_qty?: number;
    status?: string;
    started_at?: string | null;
    operation_type?: string | null;
    picked_qty?: number | null;
  };

  // 若呼叫端尚未寫入 picking_logs，這裡補一筆，避免進度不連動。
  if (qty > 0) {
    let dupQ = admin
      .from("picking_logs")
      .select("id")
      .eq("task_id", String(tr.id))
      .eq("actual_qty", qty)
      .order("created_at", { ascending: false })
      .limit(1);
    if (scanPayload) dupQ = dupQ.eq("nfc_uid", scanPayload);
    const { data: recentLog } = await dupQ.maybeSingle();
    if (!recentLog) {
      const logRow: Record<string, unknown> = {
        task_id: String(tr.id),
        order_no: String(tr.order_no),
        item_no: String(tr.item_code ?? ""),
        nfc_uid: scanPayload || `LEDGER:${new Date().toISOString()}`,
        actual_qty: qty,
        operator: operatorName || null,
        operator_name: operatorName || null,
      };
      await admin.from("picking_logs").insert(logRow);
    }
  }

  let completedQty = 0;
  if (supportsPickedQty) {
    const prevPicked = Number(tr.picked_qty ?? 0);
    completedQty = Math.max(0, prevPicked + qty);
  } else {
    let sumQ = admin
      .from("picking_logs")
      .select("actual_qty")
      .eq("task_id", String(tr.id));
    const { data: taskLogs } = await sumQ;
    completedQty = (taskLogs ?? []).reduce(
      (s, r) => s + (Number((r as { actual_qty?: number }).actual_qty) || 0),
      0,
    );
  }
  const requiredQty = Number(tr.target_qty) || 0;
  const itemDone = completedQty >= requiredQty && requiredQty > 0;
  const rowOp = String(tr.operation_type ?? "").trim();
  const opForTaskType = rowOp || (p.direction === "inbound" ? "inbound" : "outbound");

  const nowIso = new Date().toISOString();
  const taskPatch: Record<string, unknown> = {
    status: itemDone ? "completed" : completedQty > 0 ? "in_progress" : "pending",
    ended_at: itemDone ? nowIso : null,
  };
  if (supportsPickedQty) {
    taskPatch.picked_qty = completedQty;
    taskPatch.task_type = mapOperationToTaskType(opForTaskType);
  }
  if (!tr.started_at && completedQty > 0) {
    taskPatch.started_at = nowIso;
  }
  let taskUp = admin
    .from("picking_tasks")
    .update(taskPatch)
    .eq("id", String(tr.id));
  await taskUp;

  // 若同單號全部品項都完成，整單維持 completed（群組 UI 會顯示完成）。
  const orderSel = supportsPickedQty
    ? "id,target_qty,picked_qty,operation_type"
    : "id,target_qty";
  const orderQ = admin
    .from("picking_tasks")
    .select(orderSel)
    .eq("order_no", String(tr.order_no));
  const { data: orderTasks } = await orderQ;
  if (!orderTasks || orderTasks.length === 0) return;

  let allDone = true;
  for (const row of orderTasks) {
    let doneQty = 0;
    if (supportsPickedQty) {
      doneQty = Number((row as { picked_qty?: number | null }).picked_qty ?? 0);
    } else {
      let q = admin
        .from("picking_logs")
        .select("actual_qty")
        .eq("task_id", String((row as unknown as { id: string }).id));
      const { data: logs } = await q;
      doneQty = (logs ?? []).reduce(
        (s, lg) => s + (Number((lg as { actual_qty?: number }).actual_qty) || 0),
        0,
      );
    }
    const reqQty = Number((row as { target_qty?: number }).target_qty) || 0;
    if (doneQty < reqQty) {
      allDone = false;
      break;
    }
  }
  if (allDone) {
    let doneQ = admin
      .from("picking_tasks")
      .update({
        status: "completed",
        ended_at: nowIso,
      })
      .eq("order_no", String(tr.order_no));
    await doneQ;
  }
}

/**
 * 套用入／出庫量至 warehouse_ledger_stock 並寫入 warehouse_ledger_lines。
 * 出庫且尚無主檔：不異動庫存（ref.no_master_row），仍寫異動列供稽核。
 */
export async function applyWarehouseLedgerMove(
  admin: SupabaseClient,
  p: WarehouseLedgerMoveParams,
): Promise<{ ok: true; balance_after: number } | { ok: false; error: string }> {
  const scopedParams: WarehouseLedgerMoveParams = { ...p };
  const qty = Math.floor(Math.abs(Number(p.qty)));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "invalid_qty" };
  }

  const primaryPick = await admin
    .from("warehouse_ledger_stock")
    .select("id,stock_quantity")
    .eq("item_no", scopedParams.itemNo)
    .maybeSingle();
  let row = primaryPick.data as
    | { id: string; stock_quantity?: number | null; on_hand?: number | null }
    | null;
  let selErr = primaryPick.error;
  if (selErr && /column .*stock_quantity.* does not exist/i.test(selErr.message)) {
    const legacyPick = await admin
      .from("warehouse_ledger_stock")
      .select("id,on_hand")
      .eq("item_no", scopedParams.itemNo)
      .maybeSingle();
    row = legacyPick.data as
      | { id: string; stock_quantity?: number | null; on_hand?: number | null }
      | null;
    selErr = legacyPick.error;
  }

  if (selErr) {
    return { ok: false, error: selErr.message };
  }

  const signed = p.direction === "inbound" ? qty : -qty;

  const writeLine = async (balanceAfter: number, extraRef: LedgerMoveRef) => {
    const outboundShort =
      p.direction === "outbound" && Number.isFinite(balanceAfter) && balanceAfter < 0;
    await admin.from("warehouse_ledger_lines").insert({
      item_no: scopedParams.itemNo,
      direction: scopedParams.direction,
      qty_delta: qty,
      balance_after: balanceAfter,
      shortage_forced: outboundShort && Boolean(scopedParams.shortageForced),
      ref: { ...scopedParams.ref, ...extraRef },
    });
  };

  if (!row) {
    if (scopedParams.direction === "outbound") {
      await writeLine(0, {
        no_master_row: true,
        note: "總帳尚無此料號主檔，未扣帳（請先匯入總帳或補建主檔）。",
      });
      return { ok: true, balance_after: 0 };
    }

    const seedName = (scopedParams.seedItemName ?? "").trim().slice(0, 500);
    const seedSpec = (scopedParams.seedSpec ?? "").trim().slice(0, 500);
    const baseInsert = {
      item_no: scopedParams.itemNo,
      item_name: seedName,
      spec: seedSpec,
      updated_at: new Date().toISOString(),
    };
    // 以新欄位 stock_quantity 為主；舊庫欄位則回退 on_hand。
    const insPrimary = await admin
      .from("warehouse_ledger_stock")
      .insert({ ...baseInsert, stock_quantity: qty });
    if (insPrimary.error) {
      const fallback =
        /column .*stock_quantity.* does not exist/i.test(
          insPrimary.error.message,
        )
          ? await admin
              .from("warehouse_ledger_stock")
              .insert({ ...baseInsert, on_hand: qty })
          : null;
      if (fallback?.error) return { ok: false, error: fallback.error.message };
      if (!fallback) return { ok: false, error: insPrimary.error.message };
    }
    await writeLine(qty, { auto_created_stock_row: true });
    await syncPickingProgressAfterLedgerMove(admin, scopedParams, qty);
    return { ok: true, balance_after: qty };
  }

  const cur =
    Number(
      (row as { stock_quantity?: number | null; on_hand?: number | null })
        .stock_quantity ??
        (row as { stock_quantity?: number | null; on_hand?: number | null })
          .on_hand,
    ) || 0;
  const next = cur + signed;

  const primaryUp = await admin
    .from("warehouse_ledger_stock")
    .update({
      stock_quantity: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (primaryUp.error) {
    if (
      /column .*stock_quantity.* does not exist/i.test(primaryUp.error.message)
    ) {
      const fallbackUp = await admin
        .from("warehouse_ledger_stock")
        .update({
          on_hand: next,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (fallbackUp.error) {
        return { ok: false, error: fallbackUp.error.message };
      }
    } else {
      return { ok: false, error: primaryUp.error.message };
    }
  }

  await writeLine(next, {});
  await syncPickingProgressAfterLedgerMove(admin, scopedParams, qty);
  return { ok: true, balance_after: next };
}
