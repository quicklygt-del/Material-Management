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

export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const tenantId =
    normalizeLabelPrefix(String(b.tenant_id ?? getDefaultLabelPrefix())) ||
    getDefaultLabelPrefix();

  const denied = await assertTenantWarehouseLedgerAllowed(admin, tenantId);
  if (denied) return denied;

  const rawArr = Array.isArray(b.item_nos) ? b.item_nos : [];
  const itemNos = Array.from(
    new Set(rawArr.map((x) => normLedgerItemNo(x)).filter(Boolean)),
  );

  if (!itemNos.length) {
    return NextResponse.json({ ok: true, missing: [], valid: [], checked: 0 });
  }

  if (itemNos.length > 50000) {
    return NextResponse.json(
      { error: "單次比對請勿超過 50000 筆料號，請分批" },
      { status: 400 },
    );
  }

  const have = new Set<string>();
  const CHUNK = 1500;

  for (let i = 0; i < itemNos.length; i += CHUNK) {
    const slice = itemNos.slice(i, i + CHUNK);
    const { data: hits, error } = await admin
      .from("warehouse_ledger_stock")
      .select("item_no")
      .eq("tenant_id", tenantId)
      .in("item_no", slice);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const row of hits ?? []) have.add(String(row.item_no));
  }
  const missing = itemNos.filter((x) => !have.has(x));

  return NextResponse.json({
    ok: missing.length === 0,
    missing,
    checked: itemNos.length,
    tenant_id: tenantId,
  });
}
