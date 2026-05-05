import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { getPreviousLabelBalance } from "@/lib/universalLedgerBalance";

export const dynamic = "force-dynamic";

type ActionType = "inbound" | "pick" | "stocktake";

async function resolveSummary(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  label_record_id: string,
  qr_payload: string,
  bodySummary: string,
): Promise<string> {
  const s = bodySummary.trim();
  if (s) return s.slice(0, 2000);
  if (label_record_id) {
    const { data: lr } = await admin
      .from("label_records")
      .select("meta, qr_payload")
      .eq("id", label_record_id)
      .maybeSingle();
    if (lr) {
      const m = lr.meta as Record<string, unknown> | null;
      const fromMeta = String(
        m?.user_content ?? m?.description ?? m?.project_name ?? "",
      ).trim();
      if (fromMeta) return fromMeta.slice(0, 2000);
      const qp = String(lr.qr_payload ?? "").trim();
      if (qp) return qp.slice(0, 2000);
    }
  }
  return qr_payload.slice(0, 2000);
}

/** 單位物料卡：入庫／領用／盤點（綁定 unit_id；自動摘要與結餘） */
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
  const qr_payload = String(b.qr_payload ?? "").trim();
  const label_record_id = String(b.label_record_id ?? "").trim();
  const operator_name = String(b.operator_name ?? "現場").trim() || "現場";
  const action_type = String(b.action_type ?? "").trim() as ActionType;
  const qtyRaw = b.quantity;
  const quantity =
    typeof qtyRaw === "number"
      ? qtyRaw
      : Number.parseInt(String(qtyRaw ?? ""), 10);
  const summary_in = String(b.summary ?? "");

  if (!tenant_id || !unit_id || !qr_payload || !operator_name) {
    return NextResponse.json({ error: "缺少必填欄位" }, { status: 400 });
  }
  if (!label_record_id) {
    return NextResponse.json({ error: "缺少 label_record_id" }, { status: 400 });
  }
  if (!["inbound", "pick", "stocktake"].includes(action_type)) {
    return NextResponse.json({ error: "action_type 無效" }, { status: 400 });
  }
  if (action_type === "stocktake") {
    if (!Number.isFinite(quantity)) {
      return NextResponse.json(
        { error: "盤點請填有效整數（現存數量）" },
        { status: 400 },
      );
    }
  } else if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "數量需為正整數" }, { status: 400 });
  }

  const { data: zone, error: zErr } = await admin
    .from("storage_zones")
    .select("id,tenant_id")
    .eq("id", unit_id)
    .maybeSingle();
  if (zErr || !zone) {
    return NextResponse.json({ error: "管理單位不存在" }, { status: 400 });
  }
  if (normalizeLabelPrefix(String(zone.tenant_id)) !== tenant_id) {
    return NextResponse.json({ error: "單位與公司識別不符" }, { status: 403 });
  }

  const prevBal = await getPreviousLabelBalance(
    admin,
    tenant_id,
    unit_id,
    label_record_id,
  );

  const abs = Math.abs(Math.trunc(quantity));
  let quantity_delta: number;
  if (action_type === "inbound") quantity_delta = abs;
  else if (action_type === "pick") quantity_delta = -abs;
  else quantity_delta = Math.trunc(quantity) - prevBal;

  const summary = await resolveSummary(
    admin,
    label_record_id,
    qr_payload,
    summary_in,
  );

  const balance_after = prevBal + quantity_delta;

  const { data: inserted, error: insErr } = await admin
    .from("universal_ledger_records")
    .insert({
      tenant_id,
      unit_id,
      label_record_id,
      qr_payload,
      action_type,
      quantity_delta,
      operator_name,
      summary,
      balance_after,
      meta: {
        quantity_input_mode:
          action_type === "stocktake" ? "absolute_on_hand" : "delta_or_move",
      },
    })
    .select("id,balance_after")
    .maybeSingle();

  if (insErr) {
    return NextResponse.json(
      { error: `寫入失敗：${insErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: inserted?.id,
    balance_after: inserted?.balance_after ?? balance_after,
  });
}
