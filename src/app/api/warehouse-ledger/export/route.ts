import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { assertTenantWarehouseLedgerAllowed } from "@/lib/warehouseLedgerTenantGuard";

export const dynamic = "force-dynamic";

/**
 * ERP 異動匯出：`scope=lines`（預設）自 query `since`（ISO）起之 ledger_lines；
 * `scope=stock` 匯出主檔存量表。
 */

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const tenantId =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();

  const denied = await assertTenantWarehouseLedgerAllowed(admin, tenantId);
  if (denied) return denied;

  const scope = (url.searchParams.get("scope") ?? "lines").trim();
  let sinceIso = url.searchParams.get("since")?.trim() ?? "";

  if (!sinceIso) {
    const d = new Date();
    sinceIso = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
  }

  if (scope === "stock") {
    const { data: rows, error } = await admin
      .from("warehouse_ledger_stock")
      .select("item_no,item_name,spec,on_hand,attrs,updated_at")
      .eq("", tenantId)
      .order("item_no", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sheet = XLSX.utils.json_to_sheet(rows ?? []);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "ledger_stock");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `warehouse_ledger_stock_${tenantId}_${Date.now()}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const { data: slice, error } = await admin
    .from("warehouse_ledger_lines")
    .select(
      "created_at,direction,qty_delta,balance_after,shortage_forced,item_no,ref",
    )
    .eq("", tenantId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(100_000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const part = slice ?? [];

  const out: Record<string, unknown>[] = [];

  for (const r of part) {
    const refObj =
      typeof r.ref === "object" && r.ref !== null
        ? (r.ref as Record<string, unknown>)
        : {};
    const actionZh = r.direction === "outbound" ? "出庫" : "入庫";
    const refOrder = refObj.order_no != null ? String(refObj.order_no) : "";
    const refOp =
      refObj.operator_name != null ? String(refObj.operator_name) : "";
    const noMasterRow = Boolean(refObj.no_master_row);

    const displayDelta =
      r.direction === "outbound"
        ? -Math.abs(Number(r.qty_delta) || 0)
        : Number(r.qty_delta) || 0;

    out.push({
      時間: String(r.created_at),
      料號: r.item_no,
      動作: actionZh,
      異動類型鍵值: String(r.direction),
      異動數: displayDelta,
      異動後結存: r.balance_after,
      主管強制放行: Boolean(r.shortage_forced),
      備註: noMasterRow ? "無主檔未扣帳" : String(refObj.note ?? ""),
      單號: refOrder,
      負責人: refOp,
    });
  }

  const sheet = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "ledger_moves");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fn = `warehouse_ledger_moves_${tenantId}_${Date.now()}.xlsx`;

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
