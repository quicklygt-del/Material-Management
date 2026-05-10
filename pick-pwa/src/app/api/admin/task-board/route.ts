import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type TaskRow = {
  id: string;
  order_no: string;
  item_no: string;
  item_name: string | null;
  spec: string | null;
  unit: string | null;
  target_qty: number | null;
  operation_type: string | null;
  status: string | null;
  assigned_operator: string | null;
  created_at: string | null;
};

export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  const { data, error } = await admin
    .from("picking_tasks")
    .select(
      "id,order_no,item_no,item_name,spec,unit,target_qty,operation_type,status,assigned_operator,created_at",
    )
    .in("status", ["pending", "in_progress", "completed"])
    .order("created_at", { ascending: false })
    .limit(3000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const groups = new Map<
    string,
    {
      id: string;
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
    }
  >();

  for (const r of (data ?? []) as TaskRow[]) {
    const orderNo = String(r.order_no ?? "").trim();
    if (!orderNo) continue;

    const operation = String(r.operation_type ?? "").trim();
    const taskType =
      operation === "inbound" ? "入庫" : operation === "stocktake" ? "盤點" : "領料/出庫";
    const rowStatus = String(r.status ?? "").trim();
    const assignedTo = String(r.assigned_operator ?? "").trim();
    const uiStatus = !assignedTo
      ? "未派單"
      : rowStatus === "completed"
        ? "完成"
        : rowStatus === "in_progress"
          ? "進行中"
          : "未進行";

    const hit = groups.get(orderNo) ?? {
      id: orderNo,
      orderNo,
      items: [],
      assignedTo,
      status: uiStatus,
      type: taskType,
      createdAt: r.created_at ?? undefined,
    };

    hit.items.push({
      partNo: String(r.item_no ?? "").trim(),
      qty: Number(r.target_qty ?? 0),
      itemName: String(r.item_name ?? "").trim() || undefined,
      spec: String(r.spec ?? "").trim() || undefined,
      unit: String(r.unit ?? "").trim() || undefined,
    });
    if (hit.status !== "進行中" && uiStatus === "進行中") hit.status = "進行中";
    if (hit.status !== "完成" && uiStatus === "完成") hit.status = "完成";
    if (!hit.assignedTo && assignedTo) hit.assignedTo = assignedTo;

    groups.set(orderNo, hit);
  }

  const tasks = Array.from(groups.values());
  return NextResponse.json({ tasks });
}
