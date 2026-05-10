import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 料號主軸庫存：material_transactions.quantity_delta 依料號加總 */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const material_item_no = url.searchParams.get("material_item_no")?.trim();

  if (!material_item_no) {
    return NextResponse.json({ error: "缺少 material_item_no" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("material_transactions")
    .select("quantity_delta")
    .eq("material_item_no", material_item_no);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const onHand = (data ?? []).reduce(
    (s, row) => s + (Number(row.quantity_delta) || 0),
    0,
  );

  return NextResponse.json({ on_hand: onHand });
}
