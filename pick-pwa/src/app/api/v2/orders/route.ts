import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const { data, error } = await admin
    .from("picking_tasks")
    .select("order_no,task_type,target_qty,picked_qty")
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  type Agg = {
    task_type: string;
    line_count: number;
    sum_target: number;
    sum_picked: number;
  };
  const byOrder = new Map<string, Agg>();

  for (const r of rows) {
    const orderNo = String(r.order_no ?? "").trim();
    if (!orderNo) continue;

    const taskType = String(r.task_type ?? "").trim() || "領料";
    const target = Math.max(0, Math.floor(Number(r.target_qty) || 0));
    const picked = Math.max(0, Number(r.picked_qty) || 0);

    const cur =
      byOrder.get(orderNo) ??
      ({
        task_type: taskType,
        line_count: 0,
        sum_target: 0,
        sum_picked: 0,
      } satisfies Agg);
    cur.line_count += 1;
    cur.sum_target += target;
    cur.sum_picked += picked;
    byOrder.set(orderNo, cur);
  }

  const orders = Array.from(byOrder.entries())
    .map(([order_no, a]) => {
      const qty_planned = a.line_count;
      const progress =
        a.sum_target > 0
          ? Math.min(100, Math.round((a.sum_picked / a.sum_target) * 100))
          : 0;
      return {
        order_no,
        task_type: a.task_type,
        qty_planned,
        progress,
      };
    })
    .sort((x, y) => x.order_no.localeCompare(y.order_no));

  return NextResponse.json({ orders });
}
