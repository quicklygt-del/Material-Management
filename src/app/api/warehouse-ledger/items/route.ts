import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
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

  const q = url.searchParams.get("q")?.trim() ?? "";
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(1500, Math.max(10, rawLimit))
    : 250;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  let qy = admin
    .from("warehouse_ledger_stock")
    .select("id,item_no,item_name,spec,on_hand,attrs,updated_at", {
      count: "exact",
    })
    .eq("", tenantId)
    .order("item_no", { ascending: true })
    .range(offset, offset + limit - 1);

  const qSafe = q.replace(/[%_*\\]/g, "");
  if (qSafe) {
    qy = qy.or(`item_no.ilike.%${qSafe}%,item_name.ilike.%${qSafe}%`);
  }

  const { data: rows, error, count } = await qy;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    : tenantId,
    items: rows ?? [],
    count: count ?? 0,
    limit,
    offset,
  });
}
