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
import {
  storageZonesSelectNameScope,
  zoneRowScopeValue,
} from "@/lib/storageZonesScope";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  inbound: "移入/入庫",
  pick: "移出/領用",
  stocktake: "盤點校正",
};

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const  =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();
  const unit_id = url.searchParams.get("unit_id")?.trim();
  const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();

  if (! || !unit_id) {
    return NextResponse.json(
      { error: "缺少 tenant 或 unit_id" },
      { status: 400 },
    );
  }

  const { data: zone, error: zErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectNameScope())
    .eq("id", unit_id)
    .maybeSingle();
  if (zErr || !zone) {
    return NextResponse.json({ error: "管理單位不存在" }, { status: 400 });
  }
  if (
    normalizeLabelPrefix(
      zoneRowScopeValue(zone as { ?: unknown; company_id?: unknown }),
    ) !== 
  ) {
    return NextResponse.json({ error: "單位與公司識別不符" }, { status: 403 });
  }

  const unitName =
    String((zone as { name?: unknown }).name ?? "").trim() || "未命名";

  const { data: rows, error } = await admin
    .from("universal_ledger_records")
    .select(
      "created_at,summary,action_type,quantity_delta,balance_after,operator_name,qr_payload,label_record_id",
    )
    .eq("", )
    .eq("unit_id", unit_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const exportRows = (rows ?? []).map((r) => ({
    日期時間: r.created_at
      ? new Date(r.created_at).toLocaleString("zh-TW", { hour12: false })
      : "",
    管理單位: unitName,
    摘要: String(r.summary ?? "").trim() || String(r.qr_payload ?? "").slice(0, 200),
    異動類型: ACTION_LABEL[String(r.action_type)] ?? String(r.action_type),
    數量變動: Number(r.quantity_delta),
    結餘: Number(r.balance_after ?? 0),
    操作員: String(r.operator_name ?? ""),
    標籤識別: String(r.label_record_id ?? r.qr_payload ?? "").slice(0, 80),
  }));

  if (exportRows.length === 0) {
    exportRows.push({
      日期時間: "",
      管理單位: unitName,
      摘要: "（尚無交易紀錄）",
      異動類型: "",
      數量變動: 0,
      結餘: 0,
      操作員: "",
      標籤識別: "",
    });
  }

  const sheet = XLSX.utils.json_to_sheet(exportRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "物料卡");

  const safeUnit = unitName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="物料卡_${safeUnit}_${stamp}.csv"`,
      },
    });
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="物料卡_${safeUnit}_${stamp}.xlsx"`,
    },
  });
}
