import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
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
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(5, rawLimit))
    : 120;

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("warehouse_ledger_lines")
    .select(
      "id,direction,qty_delta,balance_after,shortage_forced,ref,created_at",
    )
    .eq("", tenantId)
    .eq("item_no", itemNo)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lines: data ?? [], item_no: itemNo });
}
