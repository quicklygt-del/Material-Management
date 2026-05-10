import { NextResponse } from "next/server";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
import { applyWarehouseLedgerMove } from "@/lib/warehouseLedgerServer";
import {
  collectItemCodeCandidates,
  itemNoMatchesTask,
  normItemNo,
} from "@/lib/inboundItemParse";
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
  target_qty: number;
  picked_qty: number;
  status: string;
  assigned_operator: string | null;
};

function normOrder(o: string): string {
  return normItemNo(o);
}

async function loadInboundTasks(admin: NonNullable<
  ReturnType<typeof getSupabaseServiceRoleClient>
>): Promise<{ tasks: TaskRow[]; error?: string }> {
  const sel =
    "id,order_no,item_no,item_name,spec,target_qty,picked_qty,status,assigned_operator";
  const { data, error } = await admin
    .from("picking_tasks")
    .select(sel)
    .eq("operation_type", "inbound")
    .in("status", ["pending", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) {
    return { tasks: [], error: error.message };
  }

  const rawList = (data ?? []) as Record<string, unknown>[];
  const tasks: TaskRow[] = rawList.map((r) => ({
    id: String(r.id ?? ""),
    order_no: String(r.order_no ?? ""),
    item_no: String(r.item_no ?? ""),
    item_name: r.item_name != null ? String(r.item_name) : null,
    spec: r.spec != null ? String(r.spec) : null,
    target_qty: Number(r.target_qty) || 0,
    picked_qty: Number(r.picked_qty) || 0,
    status: String(r.status ?? ""),
    assigned_operator:
      r.assigned_operator != null ? String(r.assigned_operator) : null,
  }));

  const taskIds = tasks.map((t) => t.id).filter(Boolean);
  const pickedByTask = new Map<string, number>();
  if (taskIds.length > 0) {
    const { data: logs, error: lErr } = await admin
      .from("picking_logs")
      .select("task_id,actual_qty")
      .in("task_id", taskIds);
    if (lErr) {
      return { tasks: [], error: lErr.message };
    }
    for (const lg of logs ?? []) {
      const row = lg as { task_id?: string | null; actual_qty?: number | null };
      const k = String(row.task_id ?? "");
      if (!k) continue;
      const v = Number(row.actual_qty) || 0;
      pickedByTask.set(k, (pickedByTask.get(k) ?? 0) + v);
    }
  }

  for (const t of tasks) {
    const fromLogs = pickedByTask.get(t.id) ?? 0;
    t.picked_qty = Math.max(t.picked_qty, fromLogs);
  }

  return { tasks };
}

export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const { tasks, error } = await loadInboundTasks(admin);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const orderNo = normOrder(String(b.order_no ?? ""));
  const scanRaw = String(b.scan ?? b.item_no ?? "");
  const qty = Math.floor(Math.abs(Number(b.qty ?? 1)));
  const operatorName = normItemNo(String(b.operator_name ?? ""));

  if (!orderNo) {
    return NextResponse.json({ error: "缺少 order_no" }, { status: 400 });
  }
  if (!scanRaw.trim()) {
    return NextResponse.json({ error: "缺少 scan 或 item_no" }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty < 1) {
    return NextResponse.json({ error: "qty 須為正整數" }, { status: 400 });
  }

  const { tasks, error: loadErr } = await loadInboundTasks(admin);
  if (loadErr) {
    return NextResponse.json({ error: loadErr }, { status: 500 });
  }

  const orderTasks = tasks.filter((t) => normOrder(t.order_no) === orderNo);
  if (orderTasks.length === 0) {
    return NextResponse.json(
      { error: "此單據無待處理入庫明細" },
      { status: 400 },
    );
  }

  const candidates = collectItemCodeCandidates(scanRaw);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "無法自掃描內容取得料號" }, { status: 400 });
  }

  let matched: TaskRow | null = null;
  for (const c of candidates) {
    for (const t of orderTasks) {
      if (itemNoMatchesTask(t.item_no, c)) {
        matched = t;
        break;
      }
    }
    if (matched) break;
  }

  if (!matched) {
    return NextResponse.json(
      { error: "掃描料號與此單據明細不符" },
      { status: 400 },
    );
  }

  const itemNo = normLedgerItemNo(matched.item_no);
  if (!itemNo) {
    return NextResponse.json({ error: "料號無效" }, { status: 400 });
  }

  const r = await applyWarehouseLedgerMove(admin, {
    itemNo,
    direction: "inbound",
    qty,
    shortageForced: false,
    ref: {
      order_no: orderNo,
      task_id: matched.id,
      operator_name: operatorName || undefined,
      scan_payload: normItemNo(scanRaw).slice(0, 240),
    },
    seedItemName: matched.item_name ?? undefined,
    seedSpec: matched.spec ?? undefined,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    balance_after: r.balance_after,
    item_no: itemNo,
    order_no: orderNo,
  });
}
