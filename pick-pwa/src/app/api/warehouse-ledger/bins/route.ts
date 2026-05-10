import { NextResponse } from "next/server";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
import { listBinsForItem } from "@/lib/ledgerBinCore";
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

  const itemNo = normLedgerItemNo(new URL(req.url).searchParams.get("item_no"));
  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }

  const r = await listBinsForItem(admin, itemNo);
  if (!r.ok) {
    if (/does not exist|42P01|relation/i.test(r.error)) {
      return NextResponse.json({ bins: [], item_no: itemNo, bins_disabled: true });
    }
    return NextResponse.json({ error: r.error }, { status: 500 });
  }

  return NextResponse.json({ bins: r.bins, item_no: itemNo });
}
