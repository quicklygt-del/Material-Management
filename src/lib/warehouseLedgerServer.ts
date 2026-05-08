import type { SupabaseClient } from "@supabase/supabase-js";
import type { WarehouseLedgerDirection } from "@/lib/warehouseLedger";

export type LedgerMoveRef = Record<string, unknown>;

export type WarehouseLedgerMoveParams = {
  tenantId: string;
  itemNo: string;
  direction: WarehouseLedgerDirection;
  qty: number;
  shortageForced: boolean;
  ref: LedgerMoveRef;
  seedItemName?: string;
  seedSpec?: string;
};

/**
 * 套用入／出庫量至 warehouse_ledger_stock 並寫入 warehouse_ledger_lines。
 * 出庫且尚無主檔：不異動庫存（ref.no_master_row），仍寫異動列供稽核。
 */
export async function applyWarehouseLedgerMove(
  admin: SupabaseClient,
  p: WarehouseLedgerMoveParams,
): Promise<{ ok: true; balance_after: number } | { ok: false; error: string }> {
  const qty = Math.floor(Math.abs(Number(p.qty)));
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "invalid_qty" };
  }

  const { data: row, error: selErr } = await admin
    .from("warehouse_ledger_stock")
    .select("id,on_hand")
    .eq("", p.tenantId)
    .eq("item_no", p.itemNo)
    .maybeSingle();

  if (selErr) {
    return { ok: false, error: selErr.message };
  }

  const signed = p.direction === "inbound" ? qty : -qty;

  const writeLine = async (balanceAfter: number, extraRef: LedgerMoveRef) => {
    const outboundShort =
      p.direction === "outbound" && Number.isFinite(balanceAfter) && balanceAfter < 0;
    await admin.from("warehouse_ledger_lines").insert({
      : p.tenantId,
      item_no: p.itemNo,
      direction: p.direction,
      qty_delta: qty,
      balance_after: balanceAfter,
      shortage_forced: outboundShort && Boolean(p.shortageForced),
      ref: { ...p.ref, ...extraRef },
    });
  };

  if (!row) {
    if (p.direction === "outbound") {
      await writeLine(0, {
        no_master_row: true,
        note: "總帳尚無此料號主檔，未扣帳（請先匯入總帳或補建主檔）。",
      });
      return { ok: true, balance_after: 0 };
    }

    const seedName = (p.seedItemName ?? "").trim().slice(0, 500);
    const seedSpec = (p.seedSpec ?? "").trim().slice(0, 500);
    const { error: insErr } = await admin.from("warehouse_ledger_stock").insert({
      : p.tenantId,
      item_no: p.itemNo,
      item_name: seedName,
      spec: seedSpec,
      on_hand: qty,
      updated_at: new Date().toISOString(),
    });
    if (insErr) {
      return { ok: false, error: insErr.message };
    }
    await writeLine(qty, { auto_created_stock_row: true });
    return { ok: true, balance_after: qty };
  }

  const cur = Number(row.on_hand) || 0;
  const next = cur + signed;

  const { error: upErr } = await admin
    .from("warehouse_ledger_stock")
    .update({
      on_hand: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (upErr) {
    return { ok: false, error: upErr.message };
  }

  await writeLine(next, {});
  return { ok: true, balance_after: next };
}
