import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

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
  const tenant_id = normalizeLabelPrefix(
    String(b.tenant_id ?? getDefaultLabelPrefix()),
  );
  const label_type = String(b.label_type ?? "");
  const qr_payload = String(b.qr_payload ?? "");
  const item_no_raw = String(b.item_no ?? "").trim();
  const item_no = item_no_raw || "-";
  const color_code =
    b.color_code == null || b.color_code === ""
      ? null
      : String(b.color_code);
  const operator_id = String(b.operator_id ?? "");
  const meta =
    b.meta && typeof b.meta === "object" && !Array.isArray(b.meta)
      ? (b.meta as Record<string, unknown>)
      : {};

  if (!tenant_id || !["S", "R", "B", "Q", "D"].includes(label_type)) {
    return NextResponse.json({ error: "標籤類型無效" }, { status: 400 });
  }
  if (!qr_payload) {
    return NextResponse.json({ error: "缺少 QR 內容" }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("label_records")
    .insert({
      tenant_id,
      label_type,
      qr_payload,
      item_no,
      color_code,
      operator_id: operator_id || null,
      meta,
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json(
      { error: `寫入標籤紀錄失敗：${insErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: inserted?.id });
}
