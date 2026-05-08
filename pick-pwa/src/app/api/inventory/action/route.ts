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

type ActionType = "inbound" | "pick" | "stocktake";

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
  const  =
    normalizeLabelPrefix(String(b. ?? "")) || getDefaultLabelPrefix();
  const qr_payload = String(b.qr_payload ?? "").trim();
  const label_record_id = String(b.label_record_id ?? "").trim();
  const warehouse_id = String(b.warehouse_id ?? "").trim();
  const operator_name = String(b.operator_name ?? "").trim();
  const action_type = String(b.action_type ?? "").trim() as ActionType;
  const qtyRaw = b.quantity;
  const quantity =
    typeof qtyRaw === "number"
      ? qtyRaw
      : Number.parseInt(String(qtyRaw ?? ""), 10);

  if (! || !qr_payload || !warehouse_id || !operator_name) {
    return NextResponse.json({ error: "缺少必填欄位" }, { status: 400 });
  }
  if (!["inbound", "pick", "stocktake"].includes(action_type)) {
    return NextResponse.json({ error: "action_type 無效" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity === 0) {
    return NextResponse.json({ error: "數量需為非零整數" }, { status: 400 });
  }

  const abs = Math.abs(Math.trunc(quantity));
  let quantity_delta: number;
  if (action_type === "inbound") quantity_delta = abs;
  else if (action_type === "pick") quantity_delta = -abs;
  else quantity_delta = Math.trunc(quantity);

  const { data: wh, error: wErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectIdScope())
    .eq("id", warehouse_id)
    .maybeSingle();
  if (wErr || !wh) {
    return NextResponse.json({ error: "倉庫不存在" }, { status: 400 });
  }
  if (
    normalizeLabelPrefix(
      zoneRowScopeValue(wh as { ?: unknown; company_id?: unknown }),
    ) !== 
  ) {
    return NextResponse.json({ error: "倉庫與租戶不符" }, { status: 403 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("inventory_logs")
    .insert({
      ,
      label_record_id: label_record_id || null,
      qr_payload,
      warehouse_id,
      operator_name,
      quantity_delta,
      action_type,
      meta: {},
    })
    .select("id")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json(
      { error: `寫入失敗：${insErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: inserted?.id });
}
