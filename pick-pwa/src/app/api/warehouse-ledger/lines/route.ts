import { NextResponse } from "next/server";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
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
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(5, rawLimit))
    : 120;

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }

  const fullSel =
    "id,direction,qty_delta,balance_after,shortage_forced,ref,created_at,tx_type,from_bin,to_bin,operator_name,bin_balance_after";
  const miniSel =
    "id,direction,qty_delta,balance_after,shortage_forced,ref,created_at";

  const q1 = await admin
    .from("warehouse_ledger_lines")
    .select(fullSel)
    .eq("item_no", itemNo)
    .order("created_at", { ascending: false })
    .limit(limit);
  let linesOut: unknown[] | null = q1.data as unknown[] | null;
  let error = q1.error;
  if (error && /column|42703|does not exist/i.test(error.message)) {
    const q2 = await admin
      .from("warehouse_ledger_lines")
      .select(miniSel)
      .eq("item_no", itemNo)
      .order("created_at", { ascending: false })
      .limit(limit);
    linesOut = q2.data as unknown[] | null;
    error = q2.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lines: linesOut ?? [], item_no: itemNo });
}
