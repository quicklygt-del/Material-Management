import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 單一倉別 × 標籤的庫存數（inventory_logs.quantity_delta 加總） */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const label_record_id = url.searchParams.get("label_record_id")?.trim();
  const warehouse_id = url.searchParams.get("warehouse_id")?.trim();

  if (!label_record_id || !warehouse_id) {
    return NextResponse.json(
      { error: "缺少 label_record_id 或 warehouse_id" },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("inventory_logs")
    .select("quantity_delta")
    .eq("label_record_id", label_record_id)
    .eq("warehouse_id", warehouse_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const onHand = (data ?? []).reduce(
    (s, row) => s + (Number(row.quantity_delta) || 0),
    0,
  );

  return NextResponse.json({ on_hand: onHand });
}
