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

export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  if (!(await binStockTableReady(admin))) {
    return NextResponse.json(
      { error: "尚未建立儲位表，無法移庫" },
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
  const fromBin = normLedgerBinCode(b.from_bin);
  const toBin = normLedgerBinCode(b.to_bin);
  const qty = Math.trunc(Math.abs(Number(b.qty)));
  const operatorName = String(b.operator_name ?? "").trim().slice(0, 120);

  if (!itemNo) {
    return NextResponse.json({ error: "缺少 item_no" }, { status: 400 });
  }
  if (!qty || qty <= 0) {
    return NextResponse.json({ error: "qty 須為正整數" }, { status: 400 });
  }
  if (fromBin === toBin) {
    return NextResponse.json({ error: "來源與目的儲位不可相同" }, { status: 400 });
  }

  const { data: stock } = await admin
    .from("warehouse_ledger_stock")
    .select("id")
    .eq("item_no", itemNo)
    .maybeSingle();
  if (!stock) {
    return NextResponse.json({ error: "查無此料號主檔" }, { status: 400 });
  }

  const out = await applyBinDelta(admin, itemNo, fromBin, -qty);
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: 400 });
  }
  const inn = await applyBinDelta(admin, itemNo, toBin, qty);
  if (!inn.ok) {
    await applyBinDelta(admin, itemNo, fromBin, qty);
    return NextResponse.json({ error: inn.error }, { status: 400 });
  }

  const rec = await reconcileLedgerTotalFromBins(admin, itemNo);
  if (!rec.ok) {
    return NextResponse.json({ error: rec.error }, { status: 500 });
  }

  await insertLine(admin, {
    item_no: itemNo,
    direction: "outbound",
    qty_delta: qty,
    balance_after: rec.total,
    shortage_forced: false,
    tx_type: "transfer",
    from_bin: fromBin,
    to_bin: toBin,
    operator_name: operatorName || null,
    bin_balance_after: inn.qty_after,
    ref: { transfer_qty: qty },
  });

  return NextResponse.json({
    ok: true,
    balance_total: rec.total,
    from_bin_balance: out.qty_after,
    to_bin_balance: inn.qty_after,
  });
}
