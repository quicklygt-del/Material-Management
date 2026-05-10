import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { binStockTableReady } from "@/lib/ledgerBinCore";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function txTypeZh(tx: string | null | undefined, direction: string): string {
  const t = String(tx ?? "").trim();
  if (t === "inbound" || t === "legacy_inbound") return "入庫";
  if (t === "outbound" || t === "legacy_outbound") return "出庫";
  if (t === "transfer") return "移庫";
  if (t === "stocktake") return "盤點";
  if (t === "special_issue") return "特殊領用";
  return direction === "outbound" ? "出庫" : "入庫";
}

/**
 * ERP 異動匯出：`scope=lines`（預設）自 query `since`（ISO）起之 ledger_lines；
 * `scope=stock` 匯出主檔存量表；`scope=bin_stock` 匯出儲位明細。
 */

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);

  const scope = (url.searchParams.get("scope") ?? "lines").trim();
  let sinceIso = url.searchParams.get("since")?.trim() ?? "";

  if (!sinceIso) {
    const d = new Date();
    sinceIso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  if (scope === "bin_stock") {
    if (!(await binStockTableReady(admin))) {
      return NextResponse.json(
        { error: "尚未建立儲位表" },
        { status: 400 },
      );
    }
    const { data: bins, error: bErr } = await admin
      .from("warehouse_ledger_bin_stock")
      .select("item_no,bin_code,qty,updated_at")
      .order("item_no", { ascending: true })
      .order("bin_code", { ascending: true })
      .limit(100_000);
    if (bErr) {
      return NextResponse.json({ error: bErr.message }, { status: 500 });
    }
    const sheet = XLSX.utils.json_to_sheet(bins ?? []);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "bin_stock");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `warehouse_ledger_bin_stock_${Date.now()}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  if (scope === "stock") {
    const first = await admin
      .from("warehouse_ledger_stock")
      .select("item_no,item_name,spec,stock_quantity,attrs,updated_at")
      .order("item_no", { ascending: true });
    let rows = first.data as Record<string, unknown>[] | null;
    let error = first.error;
    if (error && /column .*stock_quantity.* does not exist/i.test(error.message)) {
      const legacy = await admin
        .from("warehouse_ledger_stock")
        .select("item_no,item_name,spec,on_hand,attrs,updated_at")
        .order("item_no", { ascending: true });
      rows = legacy.data as Record<string, unknown>[] | null;
      error = legacy.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const normalized = (rows ?? []).map((r) => ({
      ...r,
      on_hand: Number(r.stock_quantity ?? r.on_hand ?? 0) || 0,
    }));
    const sheet = XLSX.utils.json_to_sheet(normalized);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "ledger_stock");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `warehouse_ledger_stock_${Date.now()}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const fullSel =
    "created_at,direction,qty_delta,balance_after,shortage_forced,item_no,ref,tx_type,from_bin,to_bin,operator_name,bin_balance_after";
  const miniSel =
    "created_at,direction,qty_delta,balance_after,shortage_forced,item_no,ref";

  let slice: Record<string, unknown>[] | null = null;
  let error = null as { message: string } | null;

  {
    const first = await admin
      .from("warehouse_ledger_lines")
      .select(fullSel)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(100_000);
    slice = (first.data ?? null) as Record<string, unknown>[] | null;
    error = first.error;
  }

  if (error && /column|42703|does not exist/i.test(error.message)) {
    const second = await admin
      .from("warehouse_ledger_lines")
      .select(miniSel)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(100_000);
    slice = (second.data ?? null) as Record<string, unknown>[] | null;
    error = second.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const part = slice ?? ([] as Record<string, unknown>[]);

  const out: Record<string, unknown>[] = [];

  for (const r of part) {
    const refObj =
      typeof r.ref === "object" && r.ref !== null
        ? (r.ref as Record<string, unknown>)
        : {};
    const rowX = r as Record<string, unknown>;
    const txType = rowX.tx_type != null ? String(rowX.tx_type) : "";
    const actionZh = txTypeZh(txType, String(rowX.direction ?? ""));
    const refOrder = refObj.order_no != null ? String(refObj.order_no) : "";
    const refOp =
      (rowX.operator_name != null && String(rowX.operator_name).trim())
        ? String(rowX.operator_name).trim()
        : refObj.operator_name != null
          ? String(refObj.operator_name)
          : "";
    const noMasterRow = Boolean(refObj.no_master_row);

    const displayDelta =
      rowX.direction === "outbound"
        ? -Math.abs(Number(rowX.qty_delta) || 0)
        : Number(rowX.qty_delta) || 0;

    const fromB =
      rowX.from_bin != null ? String(rowX.from_bin) : "";
    const toB = rowX.to_bin != null ? String(rowX.to_bin) : "";
    const binBal =
      rowX.bin_balance_after != null && rowX.bin_balance_after !== ""
        ? Number(rowX.bin_balance_after)
        : "";

    out.push({
      時間: fmtTs(String(rowX.created_at ?? "")),
      料號: rowX.item_no,
      類型: actionZh,
      異動類型鍵值: txType || String(rowX.direction ?? ""),
      來源儲位: fromB,
      目的儲位: toB,
      異動數: displayDelta,
      總帳結餘: rowX.balance_after,
      儲位結餘: binBal,
      主管強制放行: Boolean(rowX.shortage_forced),
      備註: noMasterRow ? "無主檔未扣帳" : String(refObj.note ?? ""),
      修正原因: String(refObj.correction_reason ?? ""),
      單號: refOrder,
      操作員: refOp,
    });
  }

  const sheet = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "ledger_moves");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fn = `warehouse_ledger_moves_${Date.now()}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fn}"`,
      "X-Ledger-Exported-Rows": String(out.length),
    },
  });
}
