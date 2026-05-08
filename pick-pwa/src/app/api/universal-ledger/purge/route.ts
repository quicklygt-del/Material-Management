import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import {
  storageZonesSelectIdScope,
  zoneRowScopeValue,
} from "@/lib/storageZonesScope";

export const dynamic = "force-dynamic";

/** 清空指定管理單位之 universal_ledger 明細（僅後台調用） */
export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const tenant_id =
    normalizeLabelPrefix(String(b.tenant_id ?? "")) || getDefaultLabelPrefix();
  const unit_id = String(b.unit_id ?? "").trim();
  if (!unit_id) {
    return NextResponse.json({ error: "缺少 unit_id" }, { status: 400 });
  }

  const { data: zone, error: zErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectIdScope())
    .eq("id", unit_id)
    .maybeSingle();
  if (zErr || !zone) {
    return NextResponse.json({ error: "找不到管理單位" }, { status: 404 });
  }
  if (
    normalizeLabelPrefix(
      zoneRowScopeValue(zone as { tenant_id?: unknown; company_id?: unknown }),
    ) !== tenant_id
  ) {
    return NextResponse.json({ error: "租戶不符" }, { status: 403 });
  }

  const { error: delErr, count } = await admin
    .from("universal_ledger_records")
    .delete({ count: "exact" })
    .eq("tenant_id", tenant_id)
    .eq("unit_id", unit_id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deleted: typeof count === "number" ? count : 0,
  });
}
