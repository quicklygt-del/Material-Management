import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { storageZonesSelectIdScope } from "@/lib/storageZonesScope";

export const dynamic = "force-dynamic";

/** 指定管理單位之物料卡／帳本明細（時間序） */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const unit_id = url.searchParams.get("unit_id")?.trim();

  if (!unit_id) {
    return NextResponse.json({ error: "缺少 unit_id" }, { status: 400 });
  }

  const { data: zone, error: zErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectIdScope())
    .eq("id", unit_id)
    .maybeSingle();
  if (zErr || !zone) {
    return NextResponse.json({ error: "管理單位不存在" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("universal_ledger_records")
    .select(
      "id,created_at,summary,quantity_delta,balance_after,action_type,operator_name,qr_payload,label_record_id",
    )
    .eq("unit_id", unit_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ lines: data ?? [] });
}
