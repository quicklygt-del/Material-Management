import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  normLedgerItemNo,
} from "@/lib/warehouseLedger";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { assertTenantWarehouseLedgerAllowed } from "@/lib/warehouseLedgerTenantGuard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const tenantId =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();

  const denied = await assertTenantWarehouseLedgerAllowed(admin, tenantId);
  if (denied) return denied;

  const itemNo = normLedgerItemNo(url.searchParams.get("item_no"));

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }

  const { data: row, error } = await admin
    .from("warehouse_ledger_stock")
    .select("on_hand")
    .eq("tenant_id", tenantId)
    .eq("item_no", itemNo)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      on_hand: 0,
      tenant_id: tenantId,
      item_no: itemNo,
    });
  }

  return NextResponse.json({
    found: true,
    on_hand: Number(row.on_hand) || 0,
    tenant_id: tenantId,
    item_no: itemNo,
  });
}
