import { NextResponse } from "next/server";
import {
  normLedgerItemNo,
  stripExtendedWarehouseLedgerLineCols,
} from "@/lib/warehouseLedger";
import {
  applyBinDelta,
  binStockTableReady,
  normLedgerBinCode,
  reconcileLedgerTotalFromBins,
} from "@/lib/ledgerBinCore";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

async function insertLine(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  row: Record<string, unknown>,
) {
  let ins = await admin.from("warehouse_ledger_lines").insert(row);
  if (
    ins.error &&
    /column|does not exist|42703|schema cache/i.test(String(ins.error.message))
  ) {
    const legacy = stripExtendedWarehouseLedgerLineCols(row);
    ins = await admin.from("warehouse_ledger_lines").insert(legacy);
  }
  if (ins.error) throw new Error(ins.error.message);
}

/**
 * 盤點／手動修正：僅允許已啟用儲位表；強制填寫修正原因。
 */
export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  if (!(await binStockTableReady(admin))) {
    return NextResponse.json(
      { error: "尚未建立儲位表，請先於 Supabase 執行 patch_warehouse_ledger_multi_bin.sql" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const itemNo = normLedgerItemNo(b.item_no);
  const binCode = normLedgerBinCode(b.bin_code);
  const qtyAfter = Math.trunc(Number(b.qty_after));
  const reason = String(b.reason ?? "").trim();
  const operatorName = String(b.operator_name ?? "").trim().slice(0, 120);

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "請填寫修正原因" }, { status: 400 });
  }
  if (!Number.isFinite(qtyAfter)) {
    return NextResponse.json({ error: "qty_after 無效" }, { status: 400 });
  }

  const { data: stock, error: sErr } = await admin
    .from("warehouse_ledger_stock")
    .select("id")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 });
  }
  if (!stock) {
    return NextResponse.json({ error: "查無此料號主檔" }, { status: 400 });
  }

  const { data: curRow } = await admin
    .from("warehouse_ledger_bin_stock")
    .select("qty")
    .eq("item_no", itemNo)
    .eq("bin_code", binCode)
    .maybeSingle();
  const curBin = Number((curRow as { qty?: number } | null)?.qty) || 0;
  const delta = qtyAfter - curBin;

  const bd = await applyBinDelta(admin, itemNo, binCode, delta);
  if (!bd.ok) {
    return NextResponse.json({ error: bd.error }, { status: 400 });
  }
  const rec = await reconcileLedgerTotalFromBins(admin, itemNo);
  if (!rec.ok) {
    return NextResponse.json({ error: rec.error }, { status: 500 });
  }

  const dir = delta >= 0 ? "inbound" : "outbound";
  const qtyDelta = Math.abs(delta);
  if (qtyDelta > 0) {
    await insertLine(admin, {
      item_no: itemNo,
      direction: dir,
      qty_delta: qtyDelta,
      balance_after: rec.total,
      shortage_forced: false,
      tx_type: "stocktake",
      from_bin: delta < 0 ? binCode : null,
      to_bin: delta > 0 ? binCode : null,
      operator_name: operatorName || null,
      bin_balance_after: bd.qty_after,
      ref: {
        correction_reason: reason,
        stocktake_target_bin: binCode,
        qty_before: curBin,
        qty_after: qtyAfter,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    balance_total: rec.total,
    bin_balance_after: bd.qty_after,
  });
}
