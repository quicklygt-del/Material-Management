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

  const meta =
    row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : {};

  if (itemNo) {
    const tryStock = async (cols: string) =>
      admin
        .from("warehouse_ledger_stock")
        .select(cols)
        .eq("item_no", itemNo)
        .limit(1)
        .maybeSingle();

    let stock = await tryStock("item_name,spec,stock_quantity,on_hand");
    if (
      stock.error &&
      /column .*stock_quantity.* does not exist/i.test(stock.error.message)
    ) {
      stock = await tryStock("item_name,spec,on_hand");
    }

    if (stock.error) {
      const em = stock.error.message ?? "";
      if (/42703/i.test(em)) {
        inventory = {
          item_name: String(meta.item_name ?? "").trim(),
          spec: String(meta.spec ?? "").trim(),
          on_hand: 0,
        };
      } else {
        return NextResponse.json({ error: em }, { status: 500 });
      }
    } else {
      const s = stock.data as {
        item_name?: string | null;
        spec?: string | null;
        stock_quantity?: number | null;
        on_hand?: number | null;
      } | null;
      inventory = {
        item_name: String(s?.item_name ?? meta.item_name ?? "").trim(),
        spec: String(s?.spec ?? meta.spec ?? "").trim(),
        on_hand:
          Number(s?.stock_quantity ?? s?.on_hand ?? 0) || 0,
      };
    }
  }

  return NextResponse.json({
    found: true,
    record: row,
    inventory,
  });
}
