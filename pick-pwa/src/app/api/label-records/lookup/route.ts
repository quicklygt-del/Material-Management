import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  const url = new URL(req.url);
  const qr = (url.searchParams.get("qr") ?? "").trim();
  if (!qr) {
    return NextResponse.json({ error: "missing qr" }, { status: 400 });
  }

  const byPayload = await admin
    .from("label_records")
    .select("id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta")
    .eq("qr_payload", qr)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byPayload.error) {
    return NextResponse.json({ error: byPayload.error.message }, { status: 500 });
  }

  let row = byPayload.data as Record<string, unknown> | null;
  if (!row) {
    const byItem = await admin
      .from("label_records")
      .select("id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta")
      .eq("item_no", qr)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byItem.error) {
      return NextResponse.json({ error: byItem.error.message }, { status: 500 });
    }
    row = byItem.data as Record<string, unknown> | null;
  }

  if (!row) {
    return NextResponse.json({ found: false, qr_payload: qr, message: "not found" });
  }

  const itemNo = String(row.item_no ?? "").trim();
  let inventory = { item_name: "", spec: "", on_hand: 0 };

  if (itemNo) {
    const stock = await admin
      .from("warehouse_ledger_stock")
      .select("item_name,spec,stock_quantity,on_hand")
      .eq("item_no", itemNo)
      .limit(1)
      .maybeSingle();

    if (stock.error) {
      return NextResponse.json({ error: stock.error.message }, { status: 500 });
    }

    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};

    inventory = {
      item_name: String(stock.data?.item_name ?? meta.item_name ?? "").trim(),
      spec: String(stock.data?.spec ?? meta.spec ?? "").trim(),
      on_hand: Number(stock.data?.stock_quantity ?? stock.data?.on_hand ?? 0) || 0,
    };
  }

  return NextResponse.json({
    found: true,
    record: row,
    inventory,
  });
}
