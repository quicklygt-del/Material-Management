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

function escapeIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

const MATERIAL_TYPES = ["S", "R", "B", "Q"] as const;

const SELECT_FIELDS =
  "id,tenant_id,label_type,qr_payload,item_no,color_code,created_at,meta";

/** 搜尋已建檔物料（Excel／標籤中心匯入）：料號、品名、說明等 */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const tenant_id =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    40,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );

  if (!tenant_id) {
    return NextResponse.json({ error: "無法解析公司識別" }, { status: 400 });
  }
  if (!qRaw) {
    return NextResponse.json({ materials: [] });
  }

  const pattern = `%${escapeIlike(qRaw)}%`;

  const base = () =>
    admin
      .from("label_records")
      .select(SELECT_FIELDS)
      .eq("tenant_id", tenant_id)
      .in("label_type", [...MATERIAL_TYPES]);

  const [byItem, byDesc, byProduct, bySpec] = await Promise.all([
    base()
      .ilike("item_no", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
    base()
      .filter("meta->>description", "ilike", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
    base()
      .filter("meta->>product_name", "ilike", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
    base()
      .filter("meta->>spec", "ilike", pattern)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const err = byItem.error || byDesc.error || byProduct.error || bySpec.error;
  if (err) {
    return NextResponse.json(
      { error: `查詢失敗：${err.message}` },
      { status: 500 },
    );
  }

  const map = new Map<string, (typeof byItem.data)[0]>();
  for (const row of [
    ...(byItem.data ?? []),
    ...(byDesc.data ?? []),
    ...(byProduct.data ?? []),
    ...(bySpec.data ?? []),
  ]) {
    if (row) map.set(row.id, row);
  }

  const merged = Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return NextResponse.json({ materials: merged.slice(0, limit) });
}
