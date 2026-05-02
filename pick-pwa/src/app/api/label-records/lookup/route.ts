import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
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
  const fromQuery = normalizeLabelPrefix(url.searchParams.get("tenant") ?? "");
  const tenant_id = fromQuery || getDefaultLabelPrefix();
  const qr_raw = url.searchParams.get("qr")?.trim();
  if (!tenant_id) {
    return NextResponse.json({ error: "無法解析公司識別" }, { status: 400 });
  }
  if (!qr_raw) {
    return NextResponse.json({ error: "請提供 qr（完整標籤字串）" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("label_records")
    .select(
      "id,tenant_id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta,warehouse_id,manageable_asset",
    )
    .eq("tenant_id", tenant_id)
    .eq("qr_payload", qr_raw)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `查詢失敗：${error.message}` },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ found: false, tenant_id, qr_payload: qr_raw });
  }

  return NextResponse.json({
    found: true,
    record: data,
  });
}
