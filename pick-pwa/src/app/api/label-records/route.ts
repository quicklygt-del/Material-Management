import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { getPreviousLabelBalance } from "@/lib/universalLedgerBalance";
import { storageZonesSelectIdScope } from "@/lib/storageZonesScope";

function ledgerActionSummaryPrefix(action: string): string {
  switch (action) {
    case "inbound":
      return "【📥 移入／入庫】";
    case "pick":
      return "【📤 移出／領用】";
    case "stocktake":
      return "【🔍 盤點校正】";
    default:
      return "【📥 移入／入庫】";
  }
}

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

  const allowedTypes = ["S", "R", "B", "Q", "D", "UNIVERSAL"] as const;
  if (!allowedTypes.includes(label_type as (typeof allowedTypes)[number])) {
    return NextResponse.json({ error: "標籤類型無效" }, { status: 400 });
  }
  if (!qr_payload) {
    return NextResponse.json({ error: "缺少 QR 內容" }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("label_records")
    .insert({
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

  const newId = inserted?.id;
  const unitFromMeta = String(meta.unit_id ?? "").trim();
  if (
    newId &&
    unitFromMeta &&
    (label_type === "UNIVERSAL" || label_type === "D")
  ) {
    const { data: zone } = await admin
      .from("storage_zones")
      .select(storageZonesSelectIdScope())
      .eq("id", unitFromMeta)
      .maybeSingle();
    if (zone) {
      const ledger_action = String(
        meta.ledger_action ?? "inbound",
      ).trim();
      if (
        !["inbound", "pick", "stocktake"].includes(ledger_action)
      ) {
        return NextResponse.json(
          { error: "ledger_action 須為 inbound／pick／stocktake" },
          { status: 400 },
        );
      }

      const qtyRaw = meta.ledger_qty;
      const qtyNum =
        typeof qtyRaw === "number"
          ? qtyRaw
          : Number.parseInt(String(qtyRaw ?? ""), 10);

      if (ledger_action === "stocktake") {
        if (!Number.isFinite(qtyNum)) {
          return NextResponse.json(
            { error: "盤點請填有效整數（現存數量）" },
            { status: 400 },
          );
        }
      } else if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return NextResponse.json(
          { error: "移入／移出請填正整數數量" },
          { status: 400 },
        );
      }

      const prevBal = await getPreviousLabelBalance(
        admin,
        unitFromMeta,
        newId,
      );

      const abs = Math.abs(Math.trunc(qtyNum));
      let quantity_delta: number;
      if (ledger_action === "inbound") quantity_delta = abs;
      else if (ledger_action === "pick") quantity_delta = -abs;
      else quantity_delta = Math.trunc(qtyNum) - prevBal;

      const balance_after = prevBal + quantity_delta;
      const bodyText = String(
        meta.user_content ?? meta.description ?? qr_payload,
      ).trim();
      const prefix = ledgerActionSummaryPrefix(ledger_action);
      const summaryText = `${prefix} ${bodyText}`.trim().slice(0, 2000);

      const { error: ledErr } = await admin
        .from("universal_ledger_records")
        .insert({
          unit_id: unitFromMeta,
          label_record_id: newId,
          qr_payload,
          action_type: ledger_action,
          quantity_delta,
          operator_name: "標籤產製",
          summary: summaryText || prefix,
          balance_after,
          meta: {
            origin: "label_records_post",
            action_category: ledger_action,
            quantity_input_mode:
              ledger_action === "stocktake"
                ? "absolute_on_hand"
                : "move_qty",
          },
        });
      if (ledErr) {
        return NextResponse.json(
          {
            error: `標籤已建立，但異動明細建檔失敗：${ledErr.message}`,
          },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({ ok: true, id: newId });
}
