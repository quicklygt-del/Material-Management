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

type MoveAction = "pick" | "return";

export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const tenant_id =
    normalizeLabelPrefix(String(b.tenant_id ?? "")) || getDefaultLabelPrefix();
  const action = String(b.action ?? "").trim() as MoveAction;
  const operator_name = String(b.operator_name ?? "").trim();
  const order_no = String(b.order_no ?? "").trim();
  const item_no = String(b.item_no ?? "").trim();
  const label_record_id = String(b.label_record_id ?? "").trim();
  const qr_payload = String(b.qr_payload ?? "").trim();
  const qtyRaw = Number(b.quantity ?? 0);
  const quantity =
    Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 0;

  if (!tenant_id || !operator_name || !item_no || !label_record_id || !qr_payload) {
    return NextResponse.json({ error: "缺少必要欄位" }, { status: 400 });
  }
  if (action !== "pick" && action !== "return") {
    return NextResponse.json({ error: "action 僅可為 pick 或 return" }, { status: 400 });
  }
  if (quantity <= 0) {
    return NextResponse.json({ error: "數量須為正整數" }, { status: 400 });
  }

  const delta = action === "pick" ? -quantity : quantity;

  const pick = await admin
    .from("warehouse_ledger_stock")
    .select("id,stock_quantity,on_hand")
    .eq("tenant_id", tenant_id)
    .eq("item_no", item_no)
    .maybeSingle();
  if (pick.error) {
    return NextResponse.json({ error: pick.error.message }, { status: 500 });
  }

  const current =
    Number(
      (pick.data as { stock_quantity?: number | null; on_hand?: number | null } | null)
        ?.stock_quantity ??
        (pick.data as { stock_quantity?: number | null; on_hand?: number | null } | null)
          ?.on_hand ??
        0,
    ) || 0;
  const next = current + delta;

  if (!pick.data) {
    const { error: insErr } = await admin.from("warehouse_ledger_stock").insert({
      tenant_id,
      item_no,
      item_name: "",
      spec: "",
      stock_quantity: next,
    });
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  } else {
    const { error: upErr } = await admin
      .from("warehouse_ledger_stock")
      .update({
        stock_quantity: next,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (pick.data as { id: string }).id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  const txPayload: Record<string, unknown> = {
    tenant_id,
    operator_name,
    order_no: order_no || null,
    item_no,
    label_record_id,
    qr_payload,
    action_type: action,
    quantity_delta: delta,
  };
  const { error: txErr } = await admin.from("inventory_transactions").insert(txPayload);
  if (txErr) {
    return NextResponse.json(
      {
        error: `庫存已更新，但交易紀錄寫入失敗：${txErr.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, on_hand: next, quantity_delta: delta });
}
