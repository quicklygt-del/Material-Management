import { NextResponse } from "next/server";
import {
  normLedgerItemNo,
} from "@/lib/warehouseLedger";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);

  const itemNo = normLedgerItemNo(url.searchParams.get("item_no"));

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }

  let row: { stock_quantity?: number | null; on_hand?: number | null } | null = null;
  let errorMessage = "";
  const first = await admin
    .from("warehouse_ledger_stock")
    .select("stock_quantity")
    .eq("item_no", itemNo)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!first.error) {
    row = first.data as { stock_quantity?: number | null } | null;
  } else {
    errorMessage = first.error.message || "";
    if (/column .*stock_quantity.* does not exist/i.test(errorMessage)) {
      const fallback = await admin
        .from("warehouse_ledger_stock")
        .select("on_hand")
        .eq("item_no", itemNo)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallback.error) {
        return NextResponse.json(
          { error: fallback.error.message || errorMessage },
          { status: 500 },
        );
      }
      row = fallback.data as { on_hand?: number | null } | null;
    } else {
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      on_hand: 0,
      item_no: itemNo,
    });
  }

  return NextResponse.json({
    found: true,
    on_hand:
      Number(
        row?.stock_quantity ?? row?.on_hand,
      ) || 0,
    item_no: itemNo,
  });
}
