import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 即時流動監控主表：inventory_flow（全域、無租戶／公司別過濾） */

function dwellHours(enteredAt: string): number {
  const t = new Date(enteredAt).getTime();
  if (Number.isNaN(t)) return 0;
  return (Date.now() - t) / 3600000;
}

export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const thresholdRaw = Number(
    process.env.INVENTORY_FLOW_STALL_THRESHOLD_HOURS ?? "4",
  );
  const thresholdHours = Number.isFinite(thresholdRaw)
    ? Math.min(168, Math.max(0.5, thresholdRaw))
    : 4;

  const { data: rows, error } = await admin
    .from("inventory_flow")
    .select(
      "id,item_no,po_no,item_name,current_stage,location_label,entered_at,updated_at",
    )
    .order("entered_at", { ascending: true })
    .limit(500);

  if (error) {
    if (/does not exist|42P01|relation/i.test(error.message)) {
      return NextResponse.json({
        threshold_hours: thresholdHours,
        flows: [],
        alerts: [],
        stats: {
          pending_inspect: 0,
          pending_putaway: 0,
          stocked: 0,
          pending_ship: 0,
        },
        table_missing: true,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const flows = (rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const enteredAt = String(row.entered_at ?? "");
    const dh = dwellHours(enteredAt);
    return {
      id: String(row.id ?? ""),
      item_no: String(row.item_no ?? "").trim(),
      po_no: String(row.po_no ?? "").trim(),
      item_name: String(row.item_name ?? "").trim(),
      current_stage: String(row.current_stage ?? "").trim(),
      location_label: String(row.location_label ?? "").trim(),
      entered_at: enteredAt,
      updated_at: String(row.updated_at ?? ""),
      dwell_hours: dh,
    };
  });

  const alertStagePri = (stage: string): number => {
    if (stage === "pending_inspect") return 0;
    if (stage === "pending_putaway") return 1;
    if (stage === "pending_ship") return 2;
    return 3;
  };
  const alerts = flows
    .filter((f) => f.dwell_hours >= thresholdHours)
    .sort((a, b) => {
      const p = alertStagePri(a.current_stage) - alertStagePri(b.current_stage);
      if (p !== 0) return p;
      return b.dwell_hours - a.dwell_hours;
    })
    .slice(0, 20);

  const stats = {
    pending_inspect: flows.filter((f) => f.current_stage === "pending_inspect")
      .length,
    pending_putaway: flows.filter((f) => f.current_stage === "pending_putaway")
      .length,
    stocked: flows.filter((f) => f.current_stage === "stocked").length,
    pending_ship: flows.filter((f) => f.current_stage === "pending_ship").length,
  };

  return NextResponse.json({
    threshold_hours: thresholdHours,
    flows,
    alerts,
    stats,
  });
}
