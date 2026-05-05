import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { buildQrLookupCandidates } from "@/lib/qrLookupNormalize";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const LABEL_SELECT =
  "id,tenant_id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta,warehouse_id,manageable_asset";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const fromQuery = normalizeLabelPrefix(url.searchParams.get("tenant") ?? "");
  const tenant_id = fromQuery || getDefaultLabelPrefix();
  const qr_in = url.searchParams.get("qr")?.trim() ?? "";
  if (!tenant_id) {
    return NextResponse.json({ error: "無法解析公司識別" }, { status: 400 });
  }
  if (!qr_in) {
    return NextResponse.json({ error: "請提供 qr（完整標籤字串）" }, { status: 400 });
  }

  const candidates = buildQrLookupCandidates(qr_in);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "qr 內容無法解析" },
      { status: 400 },
    );
  }

  const tryPayloads = candidates.slice(0, 32);

  const { data: byPayload, error: e1 } = await admin
    .from("label_records")
    .select(LABEL_SELECT)
    .eq("tenant_id", tenant_id)
    .in("qr_payload", tryPayloads)
    .order("created_at", { ascending: false })
    .limit(1);

  if (e1) {
    return NextResponse.json(
      { error: `查詢失敗：${e1.message}` },
      { status: 500 },
    );
  }

  let row = byPayload?.[0] ?? null;

  if (!row) {
    const { data: byItem, error: e2 } = await admin
      .from("label_records")
      .select(LABEL_SELECT)
      .eq("tenant_id", tenant_id)
      .in("item_no", tryPayloads)
      .order("created_at", { ascending: false })
      .limit(1);
    if (e2) {
      return NextResponse.json(
        { error: `查詢失敗：${e2.message}` },
        { status: 500 },
      );
    }
    row = byItem?.[0] ?? null;
  }

  if (!row) {
    for (const c of tryPayloads) {
      if (!UUID_RE.test(c)) continue;
      const { data: byId, error: e3 } = await admin
        .from("label_records")
        .select(LABEL_SELECT)
        .eq("tenant_id", tenant_id)
        .eq("id", c)
        .maybeSingle();
      if (e3) {
        return NextResponse.json(
          { error: `查詢失敗：${e3.message}` },
          { status: 500 },
        );
      }
      if (byId) {
        row = byId;
        break;
      }
    }
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      tenant_id,
      qr_payload: qr_in,
      tried: tryPayloads.slice(0, 8),
    });
  }

  return NextResponse.json({
    found: true,
    record: row,
  });
}
